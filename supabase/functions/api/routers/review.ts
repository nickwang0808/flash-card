import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { Cadence } from '../../../../src/domain/Cadence.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import type { Card } from '../../../../src/domain/Card.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { ReviewHistoryEntrySchema, type ReviewEvent, type ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import { RatingSchema, UuidSchema, toIsoTimestamp } from '../../../../src/domain/primitives.ts';
import { QueueOptionsSchema, QueueSnapshotSchema, STUDY_HORIZON_HOURS, StudyQueue, type QueueOptions } from '../../../../src/domain/StudyQueue.ts';
import { cards, decks, reviewEvents } from '../../../../src/db/schema.ts';
import { cardsOwnedBy, decodeCursor, encodeCursor, requireDeck, reviewEventsOf } from '../../../../src/db/tenant.ts';
import { protectedProcedure, t } from '../trpc.ts';

const PaginationInputSchema = z.object({ cursor: z.string().min(1).max(500).nullable().optional(), limit: z.number().int().min(1).max(100).default(50) });
const PageInfoSchema = z.object({ nextCursor: z.string().min(1).max(500).nullable() });
const ExpectedVersionSchema = z.number().int().nonnegative();
const RequestIdSchema = UuidSchema;
const ReviewRateInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, rating: RatingSchema, expectedVersion: ExpectedVersionSchema, requestId: RequestIdSchema, queue: QueueOptionsSchema });
const ReviewHistoryInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, pagination: PaginationInputSchema });
const ReviewUndoInputSchema = z.object({ reviewId: UuidSchema, deckId: UuidSchema, queue: QueueOptionsSchema });
const ReviewRateOutputSchema = z.object({ reviewId: UuidSchema, queue: QueueSnapshotSchema });
const ReviewHistoryOutputSchema = z.object({ events: z.array(ReviewHistoryEntrySchema), pageInfo: PageInfoSchema });
const ReviewUndoOutputSchema = z.object({ queue: QueueSnapshotSchema });
const UNIQUE_VIOLATION = '23505';

class ReviewRequestExists extends Error {
  constructor(readonly cardId: string, readonly requestId: string) { super('Review request already exists'); this.name = 'ReviewRequestExists'; }
}
function isUniqueViolation(error: unknown): boolean {
  const candidate = typeof error === 'object' && error !== null && 'cause' in error && error.cause !== undefined ? error.cause : error;
  return typeof candidate === 'object' && candidate !== null && 'code' in candidate && candidate.code === UNIQUE_VIOLATION;
}
function mapCard(row: typeof cards.$inferSelect): Card {
  return { id: row.id, deckId: row.deckId, name: row.name, frontMarkdown: row.frontMarkdown, backMarkdown: row.backMarkdown, speechText: row.speechText, speechLocale: row.speechLocale, tags: row.tags, suspended: row.suspended, createdAt: toIsoTimestamp(row.createdAt), updatedAt: toIsoTimestamp(row.updatedAt), nextReviewAt: row.nextReviewAt ? toIsoTimestamp(row.nextReviewAt) : null, intervalDays: row.intervalDays, reviewCount: row.reviewCount, lapseCount: row.lapseCount, version: row.version };
}
function mapEvent(row: typeof reviewEvents.$inferSelect): ReviewEvent {
  return { id: row.id, cardId: row.cardId, rating: row.rating, reviewedAt: toIsoTimestamp(row.reviewedAt), beforeState: row.beforeState, afterState: row.afterState, requestId: row.requestId, undoneAt: row.undoneAt ? toIsoTimestamp(row.undoneAt) : null, createdAt: toIsoTimestamp(row.createdAt) };
}
function mapHistory(row: typeof reviewEvents.$inferSelect): ReviewHistoryEntry {
  const event = mapEvent(row);
  return { ...event, beforeIntervalDays: event.beforeState?.intervalDays ?? null, afterIntervalDays: event.afterState.intervalDays, resultingNextReviewAt: event.afterState.nextReviewAt };
}
function cadenceStateOf(card: Card): CadenceState {
  return { nextReviewAt: card.nextReviewAt, intervalDays: card.intervalDays, reviewCount: card.reviewCount, lapseCount: card.lapseCount };
}
async function queueSnapshot(db: Parameters<typeof cardsOwnedBy>[0], userId: string, deckId: string, options: QueueOptions, now: Date) {
  const horizon = new Date(now.getTime() + STUDY_HORIZON_HOURS * 3_600_000).toISOString();
  const [studiedRows, newRows] = await Promise.all([
    cardsOwnedBy(db, userId).where(and(eq(cards.deckId, deckId), eq(cards.suspended, false), isNotNull(cards.nextReviewAt), lte(cards.nextReviewAt, horizon))).orderBy(asc(cards.nextReviewAt), asc(cards.id)).limit(options.limit),
    cardsOwnedBy(db, userId).where(and(eq(cards.deckId, deckId), eq(cards.suspended, false), isNull(cards.nextReviewAt))).orderBy(asc(cards.createdAt), asc(cards.id)).limit(options.limit),
  ]);
  return new StudyQueue().build([...studiedRows.map(({ cards: card }) => mapCard(card)), ...newRows.map(({ cards: card }) => mapCard(card))], now, options);
}

export const reviewRouter = t.router({
  rate: protectedProcedure.input(ReviewRateInputSchema).output(ReviewRateOutputSchema).mutation(async ({ ctx, input }) => {
    const now = ctx.now;
    let reviewId: string;
    try {
      reviewId = await ctx.db.transaction(async (tx) => {
        await requireDeck(tx, ctx.identity.userId, input.deckId);
        const cardRows = await cardsOwnedBy(tx, ctx.identity.userId).where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId))).limit(1).for('update', { of: cards });
        if (cardRows.length === 0) throw new ApplicationError('NOT_FOUND', 'Card not found');
        const card = mapCard(cardRows[0].cards);
        const existingRows = await reviewEventsOf(tx, ctx.identity.userId).where(and(eq(reviewEvents.cardId, input.cardId), eq(reviewEvents.requestId, input.requestId))).limit(1);
        if (existingRows.length > 0) return existingRows[0].event.id;
        if (card.version !== input.expectedVersion) throw new ApplicationError('CONFLICT', `Card changed since version ${input.expectedVersion}`);
        const beforeState = cadenceStateOf(card);
        const afterState = new Cadence().rate(beforeState, input.rating, now);
        let eventRows;
        try {
          eventRows = await tx.insert(reviewEvents).values({ cardId: input.cardId, rating: input.rating, reviewedAt: now.toISOString(), beforeState, afterState, requestId: input.requestId, createdAt: now.toISOString() }).returning();
        } catch (error) {
          if (isUniqueViolation(error)) throw new ReviewRequestExists(input.cardId, input.requestId);
          throw error;
        }
        await tx.update(cards).set({ nextReviewAt: afterState.nextReviewAt, intervalDays: afterState.intervalDays, reviewCount: afterState.reviewCount, lapseCount: afterState.lapseCount, version: card.version + 1, updatedAt: now.toISOString() }).where(and(eq(cards.id, input.cardId), eq(cards.version, card.version)));
        return eventRows[0].id;
      });
    } catch (error) {
      if (!(error instanceof ReviewRequestExists)) throw error;
      const existingRows = await reviewEventsOf(ctx.db, ctx.identity.userId).where(and(eq(reviewEvents.cardId, input.cardId), eq(reviewEvents.requestId, input.requestId))).limit(1);
      if (existingRows.length === 0) throw new ApplicationError('INTERNAL', 'Review request conflicted but no event exists');
      reviewId = existingRows[0].event.id;
    }
    return { reviewId, queue: await queueSnapshot(ctx.db, ctx.identity.userId, input.deckId, input.queue, now) };
  }),
  undo: protectedProcedure.input(ReviewUndoInputSchema).output(ReviewUndoOutputSchema).mutation(async ({ ctx, input }) => {
    const now = ctx.now;
    await ctx.db.transaction(async (tx) => {
      await requireDeck(tx, ctx.identity.userId, input.deckId);
      const eventRows = await reviewEventsOf(tx, ctx.identity.userId).where(and(eq(reviewEvents.id, input.reviewId), eq(decks.id, input.deckId))).limit(1).for('update', { of: reviewEvents });
      if (eventRows.length === 0) throw new ApplicationError('NOT_FOUND', 'Review not found');
      const event = mapEvent(eventRows[0].event);
      if (event.undoneAt !== null) throw new ApplicationError('INVALID_STATE', 'Review is already undone');
      const newerRows = await reviewEventsOf(tx, ctx.identity.userId).where(and(eq(reviewEvents.cardId, event.cardId), isNull(reviewEvents.undoneAt), or(gt(reviewEvents.reviewedAt, event.reviewedAt), and(eq(reviewEvents.reviewedAt, event.reviewedAt), gt(reviewEvents.id, event.id))))).limit(1);
      if (newerRows.length > 0) throw new ApplicationError('INVALID_STATE', 'Only the latest active review can be undone');
      const cardRows = await cardsOwnedBy(tx, ctx.identity.userId).where(and(eq(cards.id, event.cardId), eq(cards.deckId, input.deckId))).limit(1).for('update', { of: cards });
      if (cardRows.length === 0) throw new ApplicationError('NOT_FOUND', 'Card not found');
      const beforeState = event.beforeState ?? { nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 };
      await tx.update(reviewEvents).set({ undoneAt: now.toISOString() }).where(eq(reviewEvents.id, event.id));
      await tx.update(cards).set({ nextReviewAt: beforeState.nextReviewAt, intervalDays: beforeState.intervalDays, reviewCount: beforeState.reviewCount, lapseCount: beforeState.lapseCount, version: cardRows[0].cards.version + 1, updatedAt: now.toISOString() }).where(eq(cards.id, event.cardId));
    });
    return { queue: await queueSnapshot(ctx.db, ctx.identity.userId, input.deckId, input.queue, now) };
  }),
  history: protectedProcedure.input(ReviewHistoryInputSchema).output(ReviewHistoryOutputSchema).query(async ({ ctx, input }) => {
    await requireDeck(ctx.db, ctx.identity.userId, input.deckId);
    const after = input.pagination.cursor ? decodeCursor(input.pagination.cursor) : null;
    const conditions: (SQL | undefined)[] = [eq(reviewEvents.cardId, input.cardId), eq(decks.id, input.deckId)];
    if (after) conditions.push(or(lt(reviewEvents.reviewedAt, after.timestamp), and(eq(reviewEvents.reviewedAt, after.timestamp), lt(reviewEvents.id, after.id))));
    const rows = await reviewEventsOf(ctx.db, ctx.identity.userId).where(and(...conditions)).orderBy(desc(reviewEvents.reviewedAt), desc(reviewEvents.id)).limit(input.pagination.limit + 1);
    const items = rows.map(({ event }) => mapHistory(event));
    const hasMore = items.length > input.pagination.limit;
    const pageItems = hasMore ? items.slice(0, input.pagination.limit) : items;
    return { events: pageItems, pageInfo: { nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1].reviewedAt, pageItems[pageItems.length - 1].id) : null } };
  }),
});

