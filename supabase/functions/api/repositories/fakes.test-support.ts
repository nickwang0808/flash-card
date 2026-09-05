import type { TransactionSql } from 'postgres';
import type { PaginationInput, PageInfo } from '../../../../src/api/pagination.ts';
import type { Card, CardContent } from '../../../../src/domain/Card.ts';
import type { CardRevision } from '../../../../src/domain/CardRevision.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import type { Deck } from '../../../../src/domain/Deck.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { Rating } from '../../../../src/domain/primitives.ts';
import type { ReviewEvent, ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import type { DeckRepository } from './DeckRepository.ts';
import type { CardRepository } from './CardRepository.ts';
import type { StudyRepository } from './StudyRepository.ts';
import { ReviewRequestExists } from './StudyRepository.ts';

/**
 * In-memory fakes implementing the repository interfaces. Used only by unit
 * tests; transaction semantics are intentionally shallow (work runs inline)
 * because rollback/locking behavior is proven by repository integration tests.
 */

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Spanish',
    defaultSpeechLocale: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

export function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    deckId: '00000000-0000-4000-8000-000000000001',
    name: 'Sample card',
    frontMarkdown: 'front',
    backMarkdown: 'back',
    tags: [],
    speechText: null,
    speechLocale: null,
    suspended: false,
    cadencePhase: null,
    nextReviewAt: null,
    intervalDays: null,
    reviewCount: 0,
    lapseCount: 0,
    schedulerVersion: null,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export class FakeDeckRepository implements DeckRepository {
  decks = new Map<string, Deck>();

  constructor(private readonly deckIds: Set<string> = new Set()) {}

  async list(): Promise<Deck[]> {
    return [...this.decks.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(deckId: string): Promise<Deck | null> {
    return this.decks.get(deckId) ?? null;
  }

  async create(input: { name: string; defaultSpeechLocale: string | null }): Promise<Deck> {
    if ([...this.decks.values()].some((deck) => deck.name === input.name)) {
      throw new ApplicationError('CONFLICT', `A deck named "${input.name}" already exists`);
    }
    const deck = makeDeck({ name: input.name, defaultSpeechLocale: input.defaultSpeechLocale });
    this.decks.set(deck.id, deck);
    this.deckIds.add(deck.id);
    return deck;
  }

  async rename(deckId: string, name: string, expectedVersion: number): Promise<Deck> {
    const deck = this.decks.get(deckId);
    if (!deck) throw new ApplicationError('NOT_FOUND', 'Deck not found');
    if (deck.version !== expectedVersion) throw new ApplicationError('CONFLICT', 'Deck changed');
    const next = { ...deck, name, updatedAt: new Date().toISOString(), version: deck.version + 1 };
    this.decks.set(deckId, next);
    return next;
  }

  async remove(deckId: string, expectedVersion: number): Promise<void> {
    const deck = this.decks.get(deckId);
    if (!deck) throw new ApplicationError('NOT_FOUND', 'Deck not found');
    if (deck.version !== expectedVersion) throw new ApplicationError('CONFLICT', 'Deck changed');
    this.decks.delete(deckId);
    this.deckIds.delete(deckId);
  }

  async owned(deckId: string): Promise<boolean> {
    return this.decks.has(deckId);
  }
}

export class FakeCardRepository implements CardRepository {
  cards = new Map<string, Card>();
  revisionLog: CardRevision[] = [];

  async transaction<T>(work: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return work(null as unknown as TransactionSql);
  }

  async get(cardId: string, deckId: string): Promise<Card | null> {
    const card = this.cards.get(cardId);
    return card && card.deckId === deckId ? card : null;
  }

  async search(input: { deckId: string | null; query: string; pagination: PaginationInput }): Promise<{
    cards: Card[];
    pageInfo: PageInfo;
  }> {
    const needle = input.query.toLowerCase();
    const cards = [...this.cards.values()].filter(
      (card) =>
        (input.deckId === null || card.deckId === input.deckId) &&
        (card.name.toLowerCase().includes(needle) ||
          card.frontMarkdown.toLowerCase().includes(needle) ||
          card.backMarkdown.toLowerCase().includes(needle) ||
          card.tags.some((tag) => tag.toLowerCase() === needle)),
    );
    return { cards, pageInfo: { nextCursor: null } };
  }

  async create(input: { deckId: string; content: CardContent; tags: string[] }): Promise<Card> {
    const card = makeCard({
      deckId: input.deckId,
      name: input.content.name,
      frontMarkdown: input.content.frontMarkdown,
      backMarkdown: input.content.backMarkdown,
      speechText: input.content.speechText,
      speechLocale: input.content.speechLocale,
      tags: input.tags,
    });
    this.cards.set(card.id, card);
    this.revisionLog.push({
      id: '00000000-0000-4000-8000-0000000000f0',
      cardId: card.id,
      eventType: 'created',
      beforeContent: null,
      afterContent: input.content,
      createdAt: card.createdAt,
    });
    return card;
  }

  async update(input: { cardId: string; deckId: string; expectedVersion: number; content: CardContent; tags: string[] }): Promise<Card> {
    const card = this.requireCard(input.cardId, input.deckId, input.expectedVersion);
    const next = { ...card, ...input.content, tags: input.tags, updatedAt: new Date().toISOString(), version: card.version + 1 };
    this.cards.set(input.cardId, next);
    this.revisionLog.push({
      id: crypto.randomUUID(),
      cardId: input.cardId,
      eventType: 'edited',
      beforeContent: {
        name: card.name,
        frontMarkdown: card.frontMarkdown,
        backMarkdown: card.backMarkdown,
        speechText: card.speechText,
        speechLocale: card.speechLocale,
      },
      afterContent: input.content,
      createdAt: next.updatedAt,
    });
    return next;
  }

  async setSuspended(input: { cardId: string; deckId: string; expectedVersion: number; suspended: boolean }): Promise<Card> {
    const card = this.requireCard(input.cardId, input.deckId, input.expectedVersion);
    const next = { ...card, suspended: input.suspended, version: card.version + 1, updatedAt: new Date().toISOString() };
    this.cards.set(input.cardId, next);
    return next;
  }

  async remove(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<void> {
    this.requireCard(input.cardId, input.deckId, input.expectedVersion);
    this.cards.delete(input.cardId);
  }

  async revisions(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{
    revisions: CardRevision[];
    pageInfo: PageInfo;
  }> {
    const revisions = this.revisionLog
      .filter((r) => r.cardId === input.cardId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { revisions, pageInfo: { nextCursor: null } };
  }

  async rollbackRevision(input: { cardId: string; deckId: string; revisionId: string; expectedVersion: number }): Promise<Card> {
    const card = this.requireCard(input.cardId, input.deckId, input.expectedVersion);
    const revision = this.revisionLog.find((r) => r.id === input.revisionId);
    if (!revision) throw new ApplicationError('NOT_FOUND', 'Revision not found');
    const next = { ...card, ...revision.afterContent, version: card.version + 1, updatedAt: new Date().toISOString() };
    this.cards.set(input.cardId, next);
    return next;
  }

  private requireCard(cardId: string, deckId: string, expectedVersion: number): Card {
    const card = this.cards.get(cardId);
    if (!card || card.deckId !== deckId) throw new ApplicationError('NOT_FOUND', 'Card not found');
    if (card.version !== expectedVersion) throw new ApplicationError('CONFLICT', 'Card changed');
    return card;
  }
}

export class FakeStudyRepository implements StudyRepository {
  constructor(
    readonly deckIds: Set<string> = new Set(),
    readonly cards: Map<string, Card> = new Map(),
  ) {}

  events: ReviewEvent[] = [];
  /** Simulate a mid-transaction failure on the next insertReviewEvent call. */
  failNextInsert = false;
  /** Simulate a concurrent winner: the next insert loses the unique-key race. */
  raceNextInsert = false;

  async transaction<T>(work: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return work(null as unknown as TransactionSql);
  }

  async deckOwned(deckId: string): Promise<boolean> {
    return this.deckIds.has(deckId);
  }

  async queueBuckets(input: { deckId: string; now: Date; horizonMs: number; limit: number }): Promise<{
    newCards: Card[];
    reviewedCards: Card[];
  }> {
    const horizon = new Date(input.now.getTime() + input.horizonMs).toISOString();
    const all = [...this.cards.values()].filter((card) => !card.suspended);
    return {
      newCards: all
        .filter((card) => card.nextReviewAt === null)
        .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)))
        .slice(0, input.limit),
      reviewedCards: all
        .filter((card) => card.nextReviewAt !== null && card.nextReviewAt <= horizon)
        .sort((a, b) =>
          a.nextReviewAt === b.nextReviewAt ? a.id.localeCompare(b.id) : a.nextReviewAt!.localeCompare(b.nextReviewAt!),
        )
        .slice(0, input.limit),
    };
  }

  async lockCardForUpdate(_tx: unknown, cardId: string, deckId: string): Promise<Card | null> {
    const card = this.cards.get(cardId);
    return card && card.deckId === deckId ? card : null;
  }

  async findReviewByRequest(_tx: unknown, cardId: string, requestId: string): Promise<ReviewEvent | null> {
    return this.events.find((e) => e.cardId === cardId && e.requestId === requestId) ?? null;
  }

  async findReviewByIdempotencyKey(cardId: string, requestId: string): Promise<ReviewEvent | null> {
    return this.events.find((e) => e.cardId === cardId && e.requestId === requestId) ?? null;
  }

  async insertReviewEvent(
    _tx: unknown,
    input: { cardId: string; rating: Rating; reviewedAt: Date; beforeState: CadenceState; afterState: CadenceState; requestId: string },
  ): Promise<{ inserted: boolean; event: ReviewEvent }> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error('simulated insert failure');
    }
    if (this.raceNextInsert) {
      this.raceNextInsert = false;
      throw new ReviewRequestExists(input.cardId, input.requestId);
    }
    const existing = await this.findReviewByRequest(_tx, input.cardId, input.requestId);
    if (existing) return { inserted: false, event: existing };
    const event: ReviewEvent = {
      id: crypto.randomUUID(),
      cardId: input.cardId,
      rating: input.rating,
      reviewedAt: input.reviewedAt.toISOString(),
      beforeState: input.beforeState,
      afterState: input.afterState,
      requestId: input.requestId,
      undoneAt: null,
      createdAt: input.reviewedAt.toISOString(),
    };
    this.events.push(event);
    return { inserted: true, event };
  }

  async setCardCadenceState(_tx: unknown, cardId: string, state: CadenceState): Promise<void> {
    const card = this.cards.get(cardId);
    if (!card) throw new ApplicationError('NOT_FOUND', 'Card not found');
    this.cards.set(cardId, { ...card, ...state, version: card.version + 1, updatedAt: new Date().toISOString() });
  }

  async getHistory(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{
    events: ReviewHistoryEntry[];
    pageInfo: PageInfo;
  }> {
    const events: ReviewHistoryEntry[] = this.events
      .filter((e) => e.cardId === input.cardId)
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
      .map((e) => ({
        ...e,
        beforeIntervalDays: e.beforeState?.intervalDays ?? null,
        afterIntervalDays: e.afterState.intervalDays,
        resultingNextReviewAt: e.afterState.nextReviewAt,
      }));
    return { events, pageInfo: { nextCursor: null } };
  }

  async lockReviewForUpdate(_tx: unknown, reviewId: string, deckId: string): Promise<ReviewEvent | null> {
    const event = this.events.find((e) => e.id === reviewId);
    if (!event) return null;
    const card = this.cards.get(event.cardId);
    return card && card.deckId === deckId ? event : null;
  }

  async isLatestActiveReview(_tx: unknown, cardId: string, reviewedAt: Date, reviewId: string): Promise<boolean> {
    const later = this.events.some(
      (e) =>
        e.cardId === cardId &&
        e.undoneAt === null &&
        (e.reviewedAt > reviewedAt.toISOString() ||
          (e.reviewedAt === reviewedAt.toISOString() && e.id > reviewId)),
    );
    return !later;
  }

  async markEventUndone(_tx: unknown, reviewId: string, undoneAt: Date): Promise<void> {
    const event = this.events.find((e) => e.id === reviewId);
    if (event) event.undoneAt = undoneAt.toISOString();
  }
}