import { and, desc, eq, gt, isNotNull, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import type { PaginationInput, PageInfo } from '../../../../src/api/pagination.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { Rating } from '../../../../src/domain/primitives.ts';
import type { ReviewEvent, ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import type { Card } from '../../../../src/domain/Card.ts';
import type { AppDb, DbTransaction } from '../../../../src/db/client.ts';
import { cards, decks, reviewEvents } from '../../../../src/db/schema.ts';
import type { CardRow } from '../../../../src/db/schema.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { mapCardRow, mapHistoryEntryRow, mapReviewEventRow } from './mappers.ts';

/** Tenant-scoped study persistence: queue reads, locking, cadence writes, review events, undo. */
export interface StudyRepository {
  transaction<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T>;
  deckOwned(deckId: string): Promise<boolean>;
  queueBuckets(input: { deckId: string; now: Date; horizonMs: number; limit: number }): Promise<{
    newCards: Card[];
    reviewedCards: Card[];
  }>;
  lockCardForUpdate(tx: DbTransaction, cardId: string, deckId: string): Promise<Card | null>;
  findReviewByRequest(tx: DbTransaction, cardId: string, requestId: string): Promise<ReviewEvent | null>;
  /** Idempotency re-read on the shared client; safe after a transaction aborted on a race. */
  findReviewByIdempotencyKey(cardId: string, requestId: string): Promise<ReviewEvent | null>;
  insertReviewEvent(
    tx: DbTransaction,
    input: { cardId: string; rating: Rating; reviewedAt: Date; beforeState: CadenceState | null; afterState: CadenceState; requestId: string },
  ): Promise<ReviewEvent>;
  setCardCadenceState(tx: DbTransaction, cardId: string, state: CadenceState, expectedVersion: number): Promise<void>;
  getHistory(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ events: ReviewHistoryEntry[]; pageInfo: PageInfo }>;
  lockReviewForUpdate(tx: DbTransaction, reviewId: string, deckId: string): Promise<ReviewEvent | null>;
  isLatestActiveReview(tx: DbTransaction, cardId: string, reviewedAt: Date, reviewId: string): Promise<boolean>;
  markEventUndone(tx: DbTransaction, reviewId: string, undoneAt: Date): Promise<void>;
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

function unwrapCard(rows: { cards: CardRow; decks: { id: string } }[]): CardRow | null {
  return rows.length === 0 ? null : rows[0].cards;
}

/** Keyset predicate for (reviewedAt desc, id desc) ordering: rows strictly before the cursor. */
function reviewedBeforeCursor(
  reviewedAt: typeof reviewEvents.reviewedAt,
  id: typeof reviewEvents.id,
  after: { timestamp: string; id: string },
) {
  const timestamp = new Date(after.timestamp);
  return or(lt(reviewedAt, timestamp), and(eq(reviewedAt, timestamp), lt(id, after.id)));
}

export class PostgresStudyRepository implements StudyRepository {
  constructor(
    private readonly db: AppDb,
    private readonly userId: string,
  ) {}

  transaction<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async deckOwned(deckId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: decks.id })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, this.userId)))
      .limit(1);
    return rows.length === 1;
  }

  async queueBuckets(input: { deckId: string; now: Date; horizonMs: number; limit: number }): Promise<{
    newCards: Card[];
    reviewedCards: Card[];
  }> {
    const horizon = new Date(input.now.getTime() + input.horizonMs);

    const base = () =>
      this.db.select().from(cards).innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId)));

    const [newRows, reviewedRows] = await Promise.all([
      base()
        .where(and(eq(cards.deckId, input.deckId), eq(cards.suspended, false), isNull(cards.nextReviewAt)))
        .orderBy(cards.createdAt, cards.id)
        .limit(input.limit),
      base()
        .where(and(eq(cards.deckId, input.deckId), eq(cards.suspended, false), isNotNull(cards.nextReviewAt), lte(cards.nextReviewAt, horizon)))
        .orderBy(cards.nextReviewAt, cards.id)
        .limit(input.limit),
    ]);

    return {
      newCards: newRows.map((row) => mapCardRow(row.cards)),
      reviewedCards: reviewedRows.map((row) => mapCardRow(row.cards)),
    };
  }

  async lockCardForUpdate(tx: DbTransaction, cardId: string, deckId: string): Promise<Card | null> {
    const rows = await tx
      .select()
      .from(cards)
      .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId)))
      .where(and(eq(cards.id, cardId), eq(cards.deckId, deckId)))
      .limit(1)
      .for('update', { of: cards });
    const row = unwrapCard(rows);
    return row ? mapCardRow(row) : null;
  }

  async findReviewByRequest(tx: DbTransaction, cardId: string, requestId: string): Promise<ReviewEvent | null> {
    const rows = await tx
      .select()
      .from(reviewEvents)
      .where(and(eq(reviewEvents.cardId, cardId), eq(reviewEvents.requestId, requestId)))
      .limit(1);
    return rows.length === 0 ? null : mapReviewEventRow(rows[0]);
  }

  async findReviewByIdempotencyKey(cardId: string, requestId: string): Promise<ReviewEvent | null> {
    const rows = await this.db
      .select()
      .from(reviewEvents)
      .where(and(eq(reviewEvents.cardId, cardId), eq(reviewEvents.requestId, requestId)))
      .limit(1);
    return rows.length === 0 ? null : mapReviewEventRow(rows[0]);
  }

  async insertReviewEvent(
    tx: DbTransaction,
    input: { cardId: string; rating: Rating; reviewedAt: Date; beforeState: CadenceState | null; afterState: CadenceState; requestId: string },
  ): Promise<ReviewEvent> {
    try {
      const rows = await tx
        .insert(reviewEvents)
        .values({
          cardId: input.cardId,
          rating: input.rating,
          reviewedAt: input.reviewedAt,
          beforeState: input.beforeState,
          afterState: input.afterState,
          requestId: input.requestId,
        })
        .returning();
      return mapReviewEventRow(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The transaction is aborted; replay resolution happens outside it.
        throw new ReviewRequestExists(input.cardId, input.requestId);
      }
      throw error;
    }
  }

  async setCardCadenceState(tx: DbTransaction, cardId: string, state: CadenceState, expectedVersion: number): Promise<void> {
    await tx
      .update(cards)
      .set({
        cadencePhase: state.cadencePhase,
        nextReviewAt: state.nextReviewAt ? new Date(state.nextReviewAt) : null,
        intervalDays: state.intervalDays,
        reviewCount: state.reviewCount,
        lapseCount: state.lapseCount,
        schedulerVersion: state.schedulerVersion,
        version: expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(cards.id, cardId), eq(cards.version, expectedVersion)));
  }

  async getHistory(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ events: ReviewHistoryEntry[]; pageInfo: PageInfo }> {
    const limit = input.pagination.limit + 1;
    const after = input.pagination.cursor ? decodeCursor(input.pagination.cursor) : null;
    const conditions: (SQL | undefined)[] = [eq(reviewEvents.cardId, input.cardId), eq(cards.deckId, input.deckId)];
    if (after) {
      conditions.push(reviewedBeforeCursor(reviewEvents.reviewedAt, reviewEvents.id, after));
    }

    const rows = await this.db
      .select({ event: reviewEvents })
      .from(reviewEvents)
      .innerJoin(cards, eq(cards.id, reviewEvents.cardId))
      .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId)))
      .where(and(...conditions))
      .orderBy(desc(reviewEvents.reviewedAt), desc(reviewEvents.id))
      .limit(limit);

    const items = rows.map((row) => mapHistoryEntryRow(row.event));
    const hasMore = items.length > input.pagination.limit;
    const pageItems = hasMore ? items.slice(0, input.pagination.limit) : items;
    return {
      events: pageItems,
      pageInfo: {
        nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1].reviewedAt, pageItems[pageItems.length - 1].id) : null,
      },
    };
  }

  async lockReviewForUpdate(tx: DbTransaction, reviewId: string, deckId: string): Promise<ReviewEvent | null> {
    const rows = await tx
      .select({ event: reviewEvents })
      .from(reviewEvents)
      .innerJoin(cards, eq(cards.id, reviewEvents.cardId))
      .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId)))
      .where(and(eq(reviewEvents.id, reviewId), eq(cards.deckId, deckId)))
      .limit(1)
      .for('update', { of: reviewEvents });
    return rows.length === 0 ? null : mapReviewEventRow(rows[0].event);
  }

  async isLatestActiveReview(tx: DbTransaction, cardId: string, reviewedAt: Date, reviewId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: reviewEvents.id })
      .from(reviewEvents)
      .where(
        and(
          eq(reviewEvents.cardId, cardId),
          isNull(reviewEvents.undoneAt),
          or(gt(reviewEvents.reviewedAt, reviewedAt), and(eq(reviewEvents.reviewedAt, reviewedAt), gt(reviewEvents.id, reviewId))),
        ),
      )
      .limit(1);
    return rows.length === 0;
  }

  async markEventUndone(tx: DbTransaction, reviewId: string, undoneAt: Date): Promise<void> {
    await tx.update(reviewEvents).set({ undoneAt }).where(eq(reviewEvents.id, reviewId));
  }
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
