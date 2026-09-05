import type { Sql, TransactionSql } from 'postgres';
import type { Card, CardContent } from '../../../../src/domain/Card.ts';
import type { CardRevision } from '../../../../src/domain/CardRevision.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { PaginationInput, PageInfo } from '../../../../src/api/pagination.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { mapCardRevisionRow, mapCardRow, type CardRevisionRow, type CardRow } from './mappers.ts';

/** Tenant-scoped card persistence. Every read/write verifies deck ownership. */
export interface CardRepository {
  transaction<T>(work: (tx: TransactionSql) => Promise<T>): Promise<T>;
  get(cardId: string, deckId: string): Promise<Card | null>;
  search(input: { deckId: string | null; query: string; pagination: PaginationInput }): Promise<{ cards: Card[]; pageInfo: PageInfo }>;
  create(input: { deckId: string; content: CardContent; tags: string[] }): Promise<Card>;
  update(input: { cardId: string; deckId: string; expectedVersion: number; content: CardContent; tags: string[] }): Promise<Card>;
  setSuspended(input: { cardId: string; deckId: string; expectedVersion: number; suspended: boolean }): Promise<Card>;
  remove(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<void>;
  revisions(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ revisions: CardRevision[]; pageInfo: PageInfo }>;
  rollbackRevision(input: { cardId: string; deckId: string; revisionId: string; expectedVersion: number }): Promise<Card>;
}

export class PostgresCardRepository implements CardRepository {
  /** Spliced raw into select/returning lists; a template fragment, not a quoted value. */
  private readonly cardColumns: ReturnType<Sql>;

  constructor(
    private readonly sql: Sql,
    private readonly userId: string,
  ) {
    this.cardColumns = sql`c.id, c.deck_id, c.name, c.front_markdown, c.back_markdown,
      c.speech_text, c.speech_locale, c.tags, c.suspended, c.created_at, c.updated_at, c.cadence_phase,
      c.next_review_at, c.interval_days, c.review_count, c.lapse_count, c.scheduler_version, c.version`;
  }

  transaction<T>(work: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(work) as Promise<T>;
  }

  async get(cardId: string, deckId: string): Promise<Card | null> {
    const rows = await this.sql<CardRow[]>`
      select ${this.cardColumns}
      from cards c
      join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
      where c.id = ${cardId} and c.deck_id = ${deckId}
      limit 1
    `;
    return rows.length === 0 ? null : mapCardRow(rows[0]);
  }

  async search(input: { deckId: string | null; query: string; pagination: PaginationInput }): Promise<{ cards: Card[]; pageInfo: PageInfo }> {
    const { query, pagination } = input;
    const limit = pagination.limit + 1;
    const deckScope = input.deckId === null ? this.sql`` : this.sql`and c.deck_id = ${input.deckId}`;
    const after = pagination.cursor ? decodeCursor(pagination.cursor) : null;
    const afterClause = after
      ? this.sql`and (c.created_at, c.id) < (${after.timestamp}::timestamptz, ${after.id}::uuid)`
      : this.sql``;

    const rows = await this.sql<CardRow[]>`
      select ${this.cardColumns}
      from cards c
      join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
      where (
        strpos(lower(c.name), lower(${query})) > 0
        or strpos(lower(c.front_markdown), lower(${query})) > 0
        or strpos(lower(c.back_markdown), lower(${query})) > 0
        or exists (select 1 from unnest(c.tags) as tag where lower(tag) = lower(${query}))
      )
      ${deckScope}
      ${afterClause}
      order by c.created_at desc, c.id desc
      limit ${limit}
    `;

    const { items, pageInfo } = this.paginate(rows.map(mapCardRow), pagination.limit, (card) =>
      encodeCursor(card.createdAt, card.id),
    );
    return { cards: items, pageInfo };
  }

  async create(input: { deckId: string; content: CardContent; tags: string[] }): Promise<Card> {
    return this.transaction(async (tx) => {
      const rows = await tx<CardRow[]>`
        insert into cards (deck_id, name, front_markdown, back_markdown, speech_text, speech_locale, tags)
        select ${input.deckId}, ${input.content.name}, ${input.content.frontMarkdown},
               ${input.content.backMarkdown}, ${input.content.speechText}, ${input.content.speechLocale},
               ${input.tags}
        where exists (select 1 from decks where id = ${input.deckId} and user_id = ${this.userId})
        returning id, deck_id, name, front_markdown, back_markdown, speech_text,
                  speech_locale, tags, suspended, created_at, updated_at, cadence_phase,
                  next_review_at, interval_days, review_count, lapse_count, scheduler_version, version
      `;
      if (rows.length === 0) {
        throw new ApplicationError('NOT_FOUND', 'Deck not found');
      }
      const card = mapCardRow(rows[0]);
      await this.recordRevision(tx, card.id, 'created', null, input.content);
      return card;
    });
  }

  async update(input: { cardId: string; deckId: string; expectedVersion: number; content: CardContent; tags: string[] }): Promise<Card> {
    return this.transaction(async (tx) => {
      const before = await this.lockContentForUpdate(tx, input.cardId, input.deckId, input.expectedVersion);
      const rows = await tx<CardRow[]>`
        update cards c
        set name = ${input.content.name},
            front_markdown = ${input.content.frontMarkdown},
            back_markdown = ${input.content.backMarkdown},
            speech_text = ${input.content.speechText},
            speech_locale = ${input.content.speechLocale},
            tags = ${input.tags},
            version = c.version + 1,
            updated_at = now()
        from decks d
        where d.id = c.deck_id and d.user_id = ${this.userId}
          and c.id = ${input.cardId} and c.deck_id = ${input.deckId}
          and c.version = ${input.expectedVersion}
        returning c.id, c.deck_id, c.name, c.front_markdown, c.back_markdown, c.speech_text,
                  c.speech_locale, c.tags, c.suspended, c.created_at, c.updated_at, c.cadence_phase,
                  c.next_review_at, c.interval_days, c.review_count, c.lapse_count, c.scheduler_version, c.version
      `;
      if (rows.length === 0) {
        throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
      }
      const card = mapCardRow(rows[0]);
      await this.recordRevision(tx, card.id, 'edited', cardContentOf(before), input.content);
      return card;
    });
  }

  async setSuspended(input: { cardId: string; deckId: string; expectedVersion: number; suspended: boolean }): Promise<Card> {
    const rows = await this.sql<CardRow[]>`
      update cards c
      set suspended = ${input.suspended}, version = c.version + 1, updated_at = now()
      from decks d
      where d.id = c.deck_id and d.user_id = ${this.userId}
        and c.id = ${input.cardId} and c.deck_id = ${input.deckId}
        and c.version = ${input.expectedVersion}
      returning ${this.cardColumns}
    `;
    if (rows.length === 0) {
      throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
    }
    return mapCardRow(rows[0]);
  }

  async remove(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<void> {
    const result = await this.sql`
      delete from cards c
      using decks d
      where d.id = c.deck_id and d.user_id = ${this.userId}
        and c.id = ${input.cardId} and c.deck_id = ${input.deckId}
        and c.version = ${input.expectedVersion}
    `;
    if (result.count === 0) {
      throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
    }
  }

  async revisions(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ revisions: CardRevision[]; pageInfo: PageInfo }> {
    const { pagination } = input;
    const limit = pagination.limit + 1;
    const after = pagination.cursor ? decodeCursor(pagination.cursor) : null;
    const afterClause = after
      ? this.sql`and (r.created_at, r.id) < (${after.timestamp}::timestamptz, ${after.id}::uuid)`
      : this.sql``;

    const rows = await this.sql<CardRevisionRow[]>`
      select r.id, r.card_id, r.event_type, r.before_content, r.after_content, r.created_at
      from card_revisions r
      join cards c on c.id = r.card_id
      join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
      where r.card_id = ${input.cardId} and c.deck_id = ${input.deckId}
      ${afterClause}
      order by r.created_at desc, r.id desc
      limit ${limit}
    `;

    const { items, pageInfo } = this.paginate(rows.map(mapCardRevisionRow), pagination.limit, (revision) =>
      encodeCursor(revision.createdAt, revision.id),
    );
    return { revisions: items, pageInfo };
  }

  async rollbackRevision(input: { cardId: string; deckId: string; revisionId: string; expectedVersion: number }): Promise<Card> {
    return this.transaction(async (tx) => {
      const [revision] = await tx<CardRevisionRow[]>`
        select r.id, r.card_id, r.event_type, r.before_content, r.after_content, r.created_at
        from card_revisions r
        join cards c on c.id = r.card_id
        join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
        where r.id = ${input.revisionId} and r.card_id = ${input.cardId} and c.deck_id = ${input.deckId}
        limit 1
      `;
      if (!revision) {
        throw new ApplicationError('NOT_FOUND', 'Revision not found');
      }

      const rows = await tx<CardRow[]>`
        update cards c
        set name = ${revision.after_content.name},
            front_markdown = ${revision.after_content.frontMarkdown},
            back_markdown = ${revision.after_content.backMarkdown},
            speech_text = ${revision.after_content.speechText},
            speech_locale = ${revision.after_content.speechLocale},
            version = c.version + 1,
            updated_at = now()
        from decks d
        where d.id = c.deck_id and d.user_id = ${this.userId}
          and c.id = ${input.cardId} and c.deck_id = ${input.deckId}
          and c.version = ${input.expectedVersion}
        returning c.id, c.deck_id, c.name, c.front_markdown, c.back_markdown, c.speech_text,
                  c.speech_locale, c.tags, c.suspended, c.created_at, c.updated_at, c.cadence_phase,
                  c.next_review_at, c.interval_days, c.review_count, c.lapse_count, c.scheduler_version, c.version
      `;
      if (rows.length === 0) {
        throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
      }
      const card = mapCardRow(rows[0]);
      await this.recordRevision(tx, card.id, 'restored', cardContentOf(card), revision.after_content);
      return card;
    });
  }

  /** Locks the owned card row and returns its current content, or rejects on a stale version. */
  private async lockContentForUpdate(tx: TransactionSql, cardId: string, deckId: string, expectedVersion: number): Promise<Card> {
    const rows = await tx<CardRow[]>`
      select c.id, c.deck_id, c.name, c.front_markdown, c.back_markdown, c.speech_text,
             c.speech_locale, c.tags, c.suspended, c.created_at, c.updated_at, c.cadence_phase,
             c.next_review_at, c.interval_days, c.review_count, c.lapse_count, c.scheduler_version, c.version
      from cards c
      join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
      where c.id = ${cardId} and c.deck_id = ${deckId}
      for update of c
    `;
    if (rows.length === 0) {
      throw new ApplicationError('NOT_FOUND', 'Card not found');
    }
    const card = mapCardRow(rows[0]);
    if (card.version !== expectedVersion) {
      throw new ApplicationError('CONFLICT', `Card changed since version ${expectedVersion}`);
    }
    return card;
  }

  private async recordRevision(
    tx: TransactionSql,
    cardId: string,
    eventType: 'created' | 'edited' | 'restored' | 'ai_generated',
    beforeContent: CardContent | null,
    afterContent: CardContent,
  ): Promise<void> {
    await tx`
      insert into card_revisions (card_id, event_type, before_content, after_content)
      values (
        ${cardId},
        ${eventType},
        ${beforeContent === null ? null : tx.json(beforeContent)},
        ${tx.json(afterContent)}
      )
    `;
  }

  /** Resolve a failed guarded write into NOT_FOUND vs CONFLICT without leaking. */
  private async versionOrMissingError(cardId: string, deckId: string, expectedVersion: number): Promise<ApplicationError> {
    const card = await this.get(cardId, deckId);
    if (!card) {
      return new ApplicationError('NOT_FOUND', 'Card not found');
    }
    return new ApplicationError('CONFLICT', `Card changed since version ${expectedVersion}`);
  }

  private paginate<T>(rows: T[], limit: number, cursorOf: (row: T) => string): { items: T[]; pageInfo: PageInfo } {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      pageInfo: { nextCursor: hasMore ? cursorOf(items[items.length - 1]) : null },
    };
  }
}

function cardContentOf(card: Card): CardContent {
  return {
    name: card.name,
    frontMarkdown: card.frontMarkdown,
    backMarkdown: card.backMarkdown,
    speechText: card.speechText,
    speechLocale: card.speechLocale,
  };
}