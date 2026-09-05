import type { Deck } from '../../../../src/domain/Deck.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { DeckRepository } from '../repositories/DeckRepository.ts';

/** Deck lifecycle behavior, scoped to the authenticated user from context. */
export class DeckService {
  constructor(private readonly decks: DeckRepository) {}

  async list(): Promise<Deck[]> {
    return this.decks.list();
  }

  async create(input: { name: string; defaultSpeechLocale: string | null }): Promise<Deck> {
    return this.decks.create(input);
  }

  async rename(input: { deckId: string; name: string; expectedVersion: number }): Promise<Deck> {
    return this.decks.rename(input.deckId, input.name, input.expectedVersion);
  }

  async remove(input: { deckId: string; expectedVersion: number }): Promise<{ removed: true }> {
    await this.decks.remove(input.deckId, input.expectedVersion);
    return { removed: true };
  }

  /** Ownership gate shared by queue and card/study services. */
  async requireOwned(deckId: string): Promise<void> {
    if (!(await this.decks.owned(deckId))) {
      throw new ApplicationError('NOT_FOUND', 'Deck not found');
    }
  }
}