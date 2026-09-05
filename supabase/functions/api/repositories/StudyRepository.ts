import type { Sql, TransactionSql } from 'postgres';
import type { PaginationInput, PageInfo } from '../../../../src/api/pagination.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { Rating } from '../../../../src/domain/primitives.ts';
import type { ReviewEvent, ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import type { Card } from '../../../../src/domain/Card.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { mapCardRow, mapHistoryEntryRow, mapReviewEventRow, type CardRow, type ReviewEventRow } from './mappers.ts';

/** Tenant-scoped study persistence: queue reads, locking, cadence writes, review events, undo. */
export interface StudyRepository {
  transaction<T>(work: (tx: TransactionSql) => Promise<T>): Promise<T>;
  deckOwned(deckId: string): Promise<boolean>;
  queueBuckets(input: { deckId: string; now: Date; horizonMs: number; limit: number }): Promise<{
    newCards: Card[];
    reviewedCards: Card[];
  }>;
  lockCardForUpdate(tx: TransactionSql, cardId: string, deckId: string): Promise<Card | null>;
  findReviewByRequest(tx: TransactionSql, cardId: string, requestId: string): Promise<ReviewEvent | null>;
  /** Idempotency re-read on the shared client; safe after a transaction aborted on a race. */
  findReviewByIdempotencyKey(cardId: string, requestId: string): Promise<ReviewEvent | null>;
  insertReviewEvent(
    tx: TransactionSql,
    input: { cardId: string; rating: Rating; reviewedAt: Date; beforeState: CadenceState; afterState: CadenceState; requestId: string },
  ): Promise<{ inserted: boolean; event: ReviewEvent }>;
  setCardCadenceState(tx: TransactionSql, cardId: string, state: CadenceState): Promise<void>;
  getHistory(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ events: ReviewHistoryEntry[]; pageInfo: PageInfo }>;
  lockReviewForUpdate(tx: TransactionSql, reviewId: string, deckId: string): Promise<ReviewEvent | null>;
  isLatestActiveReview(tx: TransactionSql, cardId: string, reviewedAt: Date, reviewId: string): Promise<boolean>;
  markEventUndone(tx: TransactionSql, reviewId: string, undoneAt: Date): Promise<void>;
}

const UNIQUE_VIOLATION = '23505';

/** Thrown when a duplicate request_id raced an insert; the transaction is aborted. */
export class ReviewRequestExists extends Error {
  constructor(
    readonly cardId: string,
    readonly requestId: string,
  ) {
    super('Review request already exists');
    this.name = 'ReviewRequestExists';
  }
}

export class PostgresStudyRepository implements StudyRepository {
  /** Spliced raw into select lists; template fragments, not quoted values. */
  private readonly cardColumns: ReturnType<Sql>;
  private readonly eventColumns: ReturnType<Sql>;

  constructor(
    private readonly sql: Sql,
    private readonly userId: string,
  ) {
    this.cardColumns = sql`c.id, c.deck_id, c.name, c.front_markdown, c.back_markdown,
      c.speech_text, c.speech_locale, c.tags, c.suspended, c.created_at, c.updated_at, c.cadence_phase,
      c.next_review_at, c.interval_days, c.review_count, c.lapse_count, c.scheduler_version, c.version`;
    this.eventColumns = sql`e.id, e.card_id, e.rating, e.reviewed_at, e.before_state,
      e.after_state, e.request_id, e.undone_at, e.created_at`;
  }

  transaction<T>(work: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(work) as Promise<T>;
  }

  async deckOwned(deckId: string): Promise<boolean> {
    const rows = await this.sql`
      select 1 from decks where id = ${deckId} and user_id = ${this.userId} limit 1
    `;
    return rows.length === 1;
  }

  async queueBuckets(input: { deckId: string; now: Date; horizonMs: number; limit: number }): Promise<{
    newCards: Card[];
    reviewedCards: Card[];
  }> {
    const horizon = new Date(input.now.getTime() + input.horizonMs);
    const [newRows, reviewedRows] = await Promise.all([
      this.sql<CardRow[]>`
        select ${this.cardColumns}
        from cards c
        join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
        where c.deck_id = ${input.deckId}
          and not c.suspended
          and c.next_review_at is null
        order by c.created_at, c.id
        limit ${input.limit}
      `,
      this.sql<CardRow[]>`
        select ${this.cardColumns}
        from cards c
        join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
        where c.deck_id = ${input.deckId}
          and not c.suspended
          and c.next_review_at is not null
          and c.next_review_at <= ${horizon}
        order by c.next_review_at, c.id
        limit ${input.limit}
      `,
    ]);
    return { newCards: newRows.map(mapCardRow), reviewedCards: reviewedRows.map(mapCardRow) };
  }

  async lockCardForUpdate(tx: TransactionSql, cardId: string, deckId: string): Promise<Card | null> {
    const rows = await tx<CardRow[]>`
      select ${this.cardColumns}
      from cards c
      join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
      where c.id = ${cardId} and c.deck_id = ${deckId}
      for update of c
    `;
    return rows.length === 0 ? null : mapCardRow(rows[0]);
  }

  async findReviewByRequest(tx: TransactionSql, cardId: string, requestId: string): Promise<ReviewEvent | null> {
    const rows = await tx<ReviewEventRow[]>`
      select ${this.eventColumns}
      from review_events e
      where e.card_id = ${cardId} and e.request_id = ${requestId}
      limit 1
    `;
    return rows.length === 0 ? null : mapReviewEventRow(rows[0]);
  }

  async findReviewByIdempotencyKey(cardId: string, requestId: string): Promise<ReviewEvent | null> {
    const rows = await this.sql<ReviewEventRow[]>`
      select ${this.eventColumns}
      from review_events e
      where e.card_id = ${cardId} and e.request_id = ${requestId}
      limit 1
    `;
    return rows.length === 0 ? null : mapReviewEventRow(rows[0]);
  }

  async insertReviewEvent(
    tx: TransactionSql,
    input: { cardId: string; rating: Rating; reviewedAt: Date; beforeState: CadenceState; afterState: CadenceState; requestId: string },
  ): Promise<{ inserted: boolean; event: ReviewEvent }> {
    try {
      const rows = await tx<ReviewEventRow[]>`
        insert into review_events (card_id, rating, reviewed_at, before_state, after_state, request_id)
        values (
          ${input.cardId},
          ${input.rating},
          ${input.reviewedAt},
          ${input.beforeState === null ? null : tx.json(input.beforeState)},
          ${tx.json(input.afterState)},
          ${input.requestId}
        )
        returning id, card_id, rating, reviewed_at, before_state, after_state, request_id, undone_at, created_at
      `;
      return { inserted: true, event: mapReviewEventRow(rows[0]) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The transaction is aborted; replay resolution happens outside it.
        throw new ReviewRequestExists(input.cardId, input.requestId);
      }
      throw error;
    }
  }

  async setCardCadenceState(tx: TransactionSql, cardId: string, state: CadenceState): Promise<void> {
    await tx`
      update cards c
      set cadence_phase = ${state.cadencePhase},
          next_review_at = ${state.nextReviewAt ? new Date(state.nextReviewAt) : null},
          interval_days = ${state.intervalDays},
          review_count = ${state.reviewCount},
          lapse_count = ${state.lapseCount},
          scheduler_version = ${state.schedulerVersion},
          version = c.version + 1,
          updated_at = now()
      where c.id = ${cardId}
    `;
  }

  async getHistory(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ events: ReviewHistoryEntry[]; pageInfo: PageInfo }> {
    const { pagination } = input;
    const limit = pagination.limit + 1;
    const after = pagination.cursor ? decodeCursor(pagination.cursor) : null;
    const afterClause = after
      ? this.sql`and (e.reviewed_at, e.id) < (${after.timestamp}::timestamptz, ${after.id}::uuid)`
      : this.sql``;

    const rows = await this.sql<ReviewEventRow[]>`
      select ${this.eventColumns}
      from review_events e
      join cards c on c.id = e.card_id
      join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
      where e.card_id = ${input.cardId} and c.deck_id = ${input.deckId}
      ${afterClause}
      order by e.reviewed_at desc, e.id desc
      limit ${limit}
    `;

    const events = rows.map(mapHistoryEntryRow);
    const hasMore = events.length > pagination.limit;
    const items = hasMore ? events.slice(0, pagination.limit) : events;
    return {
      events: items,
      pageInfo: {
        nextCursor: hasMore ? encodeCursor(items[items.length - 1].reviewedAt, items[items.length - 1].id) : null,
      },
    };
  }

  async lockReviewForUpdate(tx: TransactionSql, reviewId: string, deckId: string): Promise<ReviewEvent | null> {
    const rows = await tx<ReviewEventRow[]>`
      select ${this.eventColumns}
      from review_events e
      join cards c on c.id = e.card_id
      join decks d on d.id = c.deck_id and d.user_id = ${this.userId}
      where e.id = ${reviewId} and c.deck_id = ${deckId}
      for update of e
    `;
    return rows.length === 0 ? null : mapReviewEventRow(rows[0]);
  }

  async isLatestActiveReview(tx: TransactionSql, cardId: string, reviewedAt: Date, reviewId: string): Promise<boolean> {
    const rows = await tx`
      select 1
      from review_events
      where card_id = ${cardId}
        and undone_at is null
        and (reviewed_at, id) > (${reviewedAt}::timestamptz, ${reviewId}::uuid)
      limit 1
    `;
    return rows.length === 0;
  }

  async markEventUndone(tx: TransactionSql, reviewId: string, undoneAt: Date): Promise<void> {
    await tx`
      update review_events
      set undone_at = ${undoneAt}
      where id = ${reviewId}
    `;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

/** Map a card DTO into its cadence state for event before/after payloads. */
export function cadenceStateOf(card: Card): CadenceState {
  return {
    cadencePhase: card.cadencePhase,
    nextReviewAt: card.nextReviewAt,
    intervalDays: card.intervalDays,
    reviewCount: card.reviewCount,
    lapseCount: card.lapseCount,
    schedulerVersion: card.schedulerVersion,
  };
}