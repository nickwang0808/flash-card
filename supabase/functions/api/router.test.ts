import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from './router.ts';
import type { ApiContext, Services } from './trpc.ts';
import { ApplicationError } from '../../../src/domain/errors.ts';
import { Cadence } from '../../../src/domain/Cadence.ts';
import { StudyQueue } from '../../../src/domain/StudyQueue.ts';
import type { VerifiedIdentity } from './identity.ts';
import { CardService } from './services/CardService.ts';
import { DeckService } from './services/DeckService.ts';
import { StudyService } from './services/StudyService.ts';
import { FakeCardRepository, FakeDeckRepository, FakeStudyRepository, makeCard } from './repositories/fakes.test-support.ts';

const IDENTITY: VerifiedIdentity = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  issuedAt: null,
  expiresAt: null,
};

function caller(identity: VerifiedIdentity, services: Services) {
  const ctx: ApiContext = { identity, services };
  return appRouter.createCaller(ctx);
}

describe('auth.session', () => {
  it('returns the verified identity', async () => {
    const { services } = makeContext();
    const result = await caller(IDENTITY, services).auth.session({});
    expect(result.userId).toBe(IDENTITY.userId);
    expect(result.email).toBe('a@example.com');
  });
});

describe('authentication middleware', () => {
  it('rejects procedures when the context has no verified user', async () => {
    const { services } = makeContext();
    const anonymous = caller({ ...IDENTITY, userId: '' }, services);
    await expect(anonymous.deck.list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('deck procedures', () => {
  it('creates a deck and lists it deterministically', async () => {
    const { services } = makeContext();
    const c = caller(IDENTITY, services);
    const created = await c.deck.create({ name: 'Spanish', defaultSpeechLocale: null });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const listed = await c.deck.list({});
    expect(listed.decks).toHaveLength(1);
    expect(listed.decks[0].name).toBe('Spanish');
  });

  it('maps duplicate deck names to a stable CONFLICT code', async () => {
    const { services } = makeContext();
    const c = caller(IDENTITY, services);
    await c.deck.create({ name: 'Spanish', defaultSpeechLocale: null });
    const error = await c.deck.create({ name: 'Spanish', defaultSpeechLocale: null }).catch((e) => e);
    expect(error.code).toBe('CONFLICT');
    expect(error.cause).toBeInstanceOf(ApplicationError);
    expect(error.cause.code).toBe('CONFLICT');
  });

  it('rejects blank deck names through Zod', async () => {
    const { services } = makeContext();
    await expect(caller(IDENTITY, services).deck.create({ name: '   ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('card procedures', () => {
  async function withDeckAndCard() {
    const { services } = makeContext();
    const c = caller(IDENTITY, services);
    const deck = await c.deck.create({ name: 'Spanish', defaultSpeechLocale: null });
    const card = await c.card.create({
      deckId: deck.id,
      name: 'Hola',
      frontMarkdown: 'Hello',
      backMarkdown: 'Hola',
      tags: ['greeting'],
      speechText: null,
      speechLocale: null,
    });
    return { c, deck, card };
  }

  it('creates a card and records the initial revision', async () => {
    const { c, card } = await withDeckAndCard();
    expect(card.name).toBe('Hola');
    const revisions = await c.card.revisions({ cardId: card.id, deckId: card.deckId, pagination: {} });
    expect(revisions.revisions).toHaveLength(1);
    expect(revisions.revisions[0].eventType).toBe('created');
  });

  it('updates content and records before/after revisions', async () => {
    const { c, deck, card } = await withDeckAndCard();
    const updated = await c.card.update({
      cardId: card.id,
      deckId: deck.id,
      expectedVersion: 0,
      name: 'Hola!',
      frontMarkdown: 'Hello there',
      backMarkdown: 'Hola!',
      tags: [],
      speechText: null,
      speechLocale: null,
    });
    expect(updated.version).toBe(1);
    const revisions = await c.card.revisions({ cardId: card.id, deckId: deck.id, pagination: {} });
    expect(revisions.revisions).toHaveLength(2);
    expect(revisions.revisions[0].eventType).toBe('edited');
    expect(revisions.revisions[0].beforeContent?.frontMarkdown).toBe('Hello');
  });

  it('rejects scripts in Markdown through Zod', async () => {
    const { c, deck } = await withDeckAndCard();
    await expect(
      c.card.create({
        deckId: deck.id,
        name: 'Bad',
        frontMarkdown: '<script>alert(1)</script>',
        backMarkdown: 'x',
        tags: [],
        speechText: null,
        speechLocale: null,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('suspends a card and returns a replacement queue', async () => {
    const { c, deck, card } = await withDeckAndCard();
    const result = await c.card.suspend({ cardId: card.id, deckId: deck.id, expectedVersion: 0, queue: {} });
    expect(result.queue.items).toHaveLength(0);
  });

  it('applies card.rollbackRevision without touching cadence', async () => {
    const { c, deck, card } = await withDeckAndCard();
    const before = await c.card.get({ cardId: card.id, deckId: deck.id });
    await c.card.update({
      cardId: card.id,
      deckId: deck.id,
      expectedVersion: 0,
      name: 'Changed',
      frontMarkdown: 'front2',
      backMarkdown: 'back2',
      tags: [],
      speechText: null,
      speechLocale: null,
    });
    const revisions = await c.card.revisions({ cardId: card.id, deckId: deck.id, pagination: {} });
    const rolledBack = await c.card.rollbackRevision({
      cardId: card.id,
      deckId: deck.id,
      revisionId: revisions.revisions[1].id,
      expectedVersion: 1,
    });
    expect(rolledBack.name).toBe(before.name);
    expect(rolledBack.cadencePhase).toBeNull();
  });
});

describe('review procedures', () => {
  it('rates a card and returns reviewId plus a replacement queue', async () => {
    const { services } = makeContext();
    const c = caller(IDENTITY, services);
    const deck = await c.deck.create({ name: 'Spanish', defaultSpeechLocale: null });
    const card = await c.card.create({
      deckId: deck.id,
      name: 'Hola',
      frontMarkdown: 'Hello',
      backMarkdown: 'Hola',
      tags: [],
      speechText: null,
      speechLocale: null,
    });

    const result = await c.review.rate({
      cardId: card.id,
      deckId: deck.id,
      rating: 'good',
      expectedVersion: 0,
      requestId: '00000000-0000-4000-8000-0000000000a0',
      queue: {},
    });
    expect(result.reviewId).toMatch(/^[0-9a-f-]{36}$/);

    const history = await c.review.history({ cardId: card.id, deckId: deck.id, pagination: {} });
    expect(history.events).toHaveLength(1);
    expect(history.events[0].rating).toBe('good');
    expect(history.events[0].afterState.intervalDays).toBe(1);
  });

  it('undoes the latest review and exposes the undone event in history', async () => {
    const { services } = makeContext();
    const c = caller(IDENTITY, services);
    const deck = await c.deck.create({ name: 'Spanish', defaultSpeechLocale: null });
    const card = await c.card.create({
      deckId: deck.id,
      name: 'Hola',
      frontMarkdown: 'Hello',
      backMarkdown: 'Hola',
      tags: [],
      speechText: null,
      speechLocale: null,
    });
    const { reviewId } = await c.review.rate({
      cardId: card.id,
      deckId: deck.id,
      rating: 'good',
      expectedVersion: 0,
      requestId: '00000000-0000-4000-8000-0000000000a0',
      queue: {},
    });

    await c.review.undo({ reviewId, deckId: deck.id, queue: {} });

    const history = await c.review.history({ cardId: card.id, deckId: deck.id, pagination: {} });
    expect(history.events[0].undoneAt).not.toBeNull();
  });

  it('rejects a stale version with a stable CONFLICT code', async () => {
    const { services } = makeContext();
    const c = caller(IDENTITY, services);
    const deck = await c.deck.create({ name: 'Spanish', defaultSpeechLocale: null });
    const card = await c.card.create({
      deckId: deck.id,
      name: 'Hola',
      frontMarkdown: 'Hello',
      backMarkdown: 'Hola',
      tags: [],
      speechText: null,
      speechLocale: null,
    });
    const error = await c.review
      .rate({
        cardId: card.id,
        deckId: deck.id,
        rating: 'good',
        expectedVersion: 9,
        requestId: '00000000-0000-4000-8000-0000000000a0',
        queue: {},
      })
      .catch((e) => e);
    expect(error.code).toBe('CONFLICT');
    expect(error.cause).toBeInstanceOf(ApplicationError);
    expect(error.cause.code).toBe('CONFLICT');
  });

  it('rejects unknown ratings through Zod', async () => {
    const { services } = makeContext();
    const c = caller(IDENTITY, services);
    await expect(
      c.review.rate({
        cardId: '00000000-0000-4000-8000-000000000010',
        deckId: '00000000-0000-4000-8000-000000000001',
        rating: 'meh' as never,
        expectedVersion: 0,
        requestId: '00000000-0000-4000-8000-0000000000a0',
        queue: {},
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

function makeContext(): { services: Services } {
  const deckIds = new Set<string>();
  const decks = new FakeDeckRepository(deckIds);
  const cards = new FakeCardRepository();
  const study = new FakeStudyRepository(deckIds, cards.cards);
  const deckService = new DeckService(decks);
  const cardService = new CardService(cards, decks);
  const studyService = new StudyService(study, new StudyQueue(), new Cadence());
  return { services: { decks: deckService, cards: cardService, study: studyService } };
}