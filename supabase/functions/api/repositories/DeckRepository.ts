import { and, eq } from 'drizzle-orm';
import type { Deck } from '../../../../src/domain/Deck.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { AppDb } from '../../../../src/db/client.ts';
import { decks } from '../../../../src/db/schema.ts';
import { mapDeckRow } from './mappers.ts';

/** Tenant-scoped deck persistence. Every method is bound to one authenticated user. */
export interface DeckRepository {
  list(): Promise<Deck[]>;
  getById(deckId: string): Promise<Deck | null>;
  create(input: { name: string; defaultSpeechLocale: string | null }): Promise<Deck>;
  rename(deckId: string, name: string, expectedVersion: number): Promise<Deck>;
  remove(deckId: string, expectedVersion: number): Promise<void>;
  /** True when the caller owns the deck; used as the queue's ownership gate. */
  owned(deckId: string): Promise<boolean>;
}

const UNIQUE_VIOLATION = '23505';

export class PostgresDeckRepository implements DeckRepository {
  constructor(
    private readonly db: AppDb,
    private readonly userId: string,
  ) {}

  async list(): Promise<Deck[]> {
    const rows = await this.db
      .select()
      .from(decks)
      .where(eq(decks.userId, this.userId))
      .orderBy(decks.name, decks.id);
    return rows.map(mapDeckRow);
  }

  async getById(deckId: string): Promise<Deck | null> {
    const rows = await this.db
      .select()
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, this.userId)))
      .limit(1);
    return rows.length === 0 ? null : mapDeckRow(rows[0]);
  }

  async create(input: { name: string; defaultSpeechLocale: string | null }): Promise<Deck> {
    try {
      const rows = await this.db
        .insert(decks)
        .values({ userId: this.userId, name: input.name, defaultSpeechLocale: input.defaultSpeechLocale })
        .returning();
      return mapDeckRow(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationError('CONFLICT', `A deck named "${input.name}" already exists`);
      }
      throw error;
    }
  }

  async rename(deckId: string, name: string, expectedVersion: number): Promise<Deck> {
    try {
      const rows = await this.db
        .update(decks)
        .set({ name, version: expectedVersion + 1, updatedAt: new Date() })
        .where(and(eq(decks.id, deckId), eq(decks.userId, this.userId), eq(decks.version, expectedVersion)))
        .returning();
      if (rows.length === 0) {
        throw await this.versionOrMissingError(deckId, expectedVersion);
      }
      return mapDeckRow(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationError('CONFLICT', `A deck named "${name}" already exists`);
      }
      throw error;
    }
  }

  async remove(deckId: string, expectedVersion: number): Promise<void> {
    const rows = await this.db
      .delete(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, this.userId), eq(decks.version, expectedVersion)))
      .returning({ id: decks.id });
    if (rows.length === 0) {
      throw await this.versionOrMissingError(deckId, expectedVersion);
    }
  }

  async owned(deckId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: decks.id })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, this.userId)))
      .limit(1);
    return rows.length === 1;
  }

  /** Distinguishes a stale version from a missing deck so callers get the right code. */
  private async versionOrMissingError(deckId: string, expectedVersion: number): Promise<ApplicationError> {
    const exists = await this.getById(deckId);
    if (!exists) {
      return new ApplicationError('NOT_FOUND', 'Deck not found');
    }
    return new ApplicationError('CONFLICT', `Deck changed since version ${expectedVersion}`);
  }
}

function isUniqueViolation(error: unknown): boolean {
  const candidate =
    typeof error === 'object' && error !== null && 'cause' in error && error.cause !== undefined
      ? error.cause
      : error;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'code' in candidate &&
    candidate.code === UNIQUE_VIOLATION
  );
}
