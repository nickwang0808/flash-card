import type { Sql } from 'postgres';
import type { Deck } from '../../../../src/domain/Deck.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { mapDeckRow, type DeckRow } from './mappers.ts';

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
    private readonly sql: Sql,
    private readonly userId: string,
  ) {}

  async list(): Promise<Deck[]> {
    const rows = await this.sql<DeckRow[]>`
      select id, user_id, name, default_speech_locale, created_at, updated_at, version
      from decks
      where user_id = ${this.userId}
      order by name, id
    `;
    return rows.map(mapDeckRow);
  }

  async getById(deckId: string): Promise<Deck | null> {
    const rows = await this.sql<DeckRow[]>`
      select id, user_id, name, default_speech_locale, created_at, updated_at, version
      from decks
      where id = ${deckId} and user_id = ${this.userId}
      limit 1
    `;
    return rows.length === 0 ? null : mapDeckRow(rows[0]);
  }

  async create(input: { name: string; defaultSpeechLocale: string | null }): Promise<Deck> {
    try {
      const rows = await this.sql<DeckRow[]>`
        insert into decks (user_id, name, default_speech_locale)
        values (${this.userId}, ${input.name}, ${input.defaultSpeechLocale})
        returning id, user_id, name, default_speech_locale, created_at, updated_at, version
      `;
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
      const rows = await this.sql<DeckRow[]>`
        update decks
        set name = ${name}, version = version + 1, updated_at = now()
        where id = ${deckId} and user_id = ${this.userId} and version = ${expectedVersion}
        returning id, user_id, name, default_speech_locale, created_at, updated_at, version
      `;
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
    const result = await this.sql`
      delete from decks
      where id = ${deckId} and user_id = ${this.userId} and version = ${expectedVersion}
    `;
    if (result.count === 0) {
      throw await this.versionOrMissingError(deckId, expectedVersion);
    }
  }

  async owned(deckId: string): Promise<boolean> {
    const rows = await this.sql`
      select 1 from decks where id = ${deckId} and user_id = ${this.userId} limit 1
    `;
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
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}