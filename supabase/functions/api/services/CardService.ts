import type { PaginationInput, PageInfo } from '../../../../src/api/pagination.ts';
import type { Card, CardContent } from '../../../../src/domain/Card.ts';
import type { CardRevision } from '../../../../src/domain/CardRevision.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { CardRepository } from '../repositories/CardRepository.ts';
import type { DeckRepository } from '../repositories/DeckRepository.ts';

/** Card content behavior: CRUD, suspension, revisions, and rollback-as-new-revision. */
export class CardService {
  constructor(
    private readonly cards: CardRepository,
    private readonly decks: DeckRepository,
  ) {}

  async get(input: { cardId: string; deckId: string }): Promise<Card> {
    const card = await this.cards.get(input.cardId, input.deckId);
    if (!card) {
      throw new ApplicationError('NOT_FOUND', 'Card not found');
    }
    return card;
  }

  async search(input: {
    deckId: string | null;
    query: string;
    pagination: PaginationInput;
  }): Promise<{ cards: Card[]; pageInfo: PageInfo }> {
    if (input.deckId !== null) {
      await this.requireOwnedDeck(input.deckId);
    }
    return this.cards.search(input);
  }

  async create(input: { deckId: string; content: CardContent; tags: string[] }): Promise<Card> {
    await this.requireOwnedDeck(input.deckId);
    return this.cards.create(input);
  }

  async update(input: {
    cardId: string;
    deckId: string;
    expectedVersion: number;
    content: CardContent;
    tags: string[];
  }): Promise<Card> {
    return this.cards.update(input);
  }

  async suspend(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<Card> {
    return this.cards.setSuspended({ ...input, suspended: true });
  }

  async restore(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<Card> {
    return this.cards.setSuspended({ ...input, suspended: false });
  }

  async remove(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<{ removed: true }> {
    await this.cards.remove(input);
    return { removed: true };
  }

  async revisions(input: {
    cardId: string;
    deckId: string;
    pagination: PaginationInput;
  }): Promise<{ revisions: CardRevision[]; pageInfo: PageInfo }> {
    return this.cards.revisions(input);
  }

  async rollbackRevision(input: {
    cardId: string;
    deckId: string;
    revisionId: string;
    expectedVersion: number;
  }): Promise<Card> {
    return this.cards.rollbackRevision(input);
  }

  private async requireOwnedDeck(deckId: string): Promise<void> {
    if (!(await this.decks.owned(deckId))) {
      throw new ApplicationError('NOT_FOUND', 'Deck not found');
    }
  }
}