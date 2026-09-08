import { and, desc, eq, gt, isNull, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { Cadence, type CardCadence } from '../../../../src/domain/Cadence.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { ReviewHistoryEntrySchema, type ReviewEvent, type ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import { RatingSchema, UuidSchema, toIsoTimestamp } from '../../../../src/domain/primitives.ts';
import { QueueOptionsSchema, QueueSnapshotSchema } from '../../../../src/domain/StudyQueue.ts';
import { cardCadences, decks, reviewEvents } from '../../../../src/db/schema.ts';
import { cardCadencesOwnedBy, decodeCursor, encodeCursor, requireDeck, reviewEventsOf } from '../../../../src/db/tenant.ts';

import { mapCadence } from '../card-aggregate.ts';
import { queueSnapshot } from '../study-queue.ts';
import { protectedProcedure, t } from '../trpc.ts';

const PaginationInputSchema = z.object({ cursor: z.string().min(1).max(500).nullable().optional(), limit: z.number().int().min(1).max(100).default(50) });
const PageInfoSchema = z.object({ nextCursor: z.string().min(1).max(500).nullable() });
const ExpectedVersionSchema = z.number().int().nonnegative();
const ReviewRateInputSchema = z.object({ cadenceId: UuidSchema, deckId: UuidSchema, rating: RatingSchema, expectedVersion: ExpectedVersionSchema, requestId: UuidSchema, queue: QueueOptionsSchema });
const ReviewHistoryInputSchema = z.object({ cadenceId: UuidSchema, deckId: UuidSchema, pagination: PaginationInputSchema });
const ReviewUndoInputSchema = z.object({ reviewId: UuidSchema, deckId: UuidSchema, queue: QueueOptionsSchema });
const ReviewRateOutputSchema = z.object({ reviewId: UuidSchema, queue: QueueSnapshotSchema });
const ReviewHistoryOutputSchema = z.object({ events: z.array(ReviewHistoryEntrySchema), pageInfo: PageInfoSchema });
const ReviewUndoOutputSchema = z.object({ queue: QueueSnapshotSchema });
const UNIQUE_VIOLATION = '23505';

class ReviewRequestExists extends Error {
  constructor(readonly cadenceId: string, readonly requestId: string) { super('Review request already exists'); this.name = 'ReviewRequestExists'; }
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = typeof error === 'object' && error !== null && 'cause' in error && error.cause !== undefined ? error.cause : error;
  return typeof candidate === 'object' && candidate !== null && 'code' in candidate && candidate.code === UNIQUE_VIOLATION;
}

function mapEvent(row: typeof reviewEvents.$inferSelect): ReviewEvent {
  return { id: row.id, cadenceId: row.cadenceId, rating: row.rating, reviewedAt: toIsoTimestamp(row.reviewedAt), beforeState: row.beforeState, afterState: row.afterState, requestId: row.requestId, undoneAt: row.undoneAt ? toIsoTimestamp(row.undoneAt) : null, createdAt: toIsoTimestamp(row.createdAt) };
}

function mapHistory(row: typeof reviewEvents.$inferSelect): ReviewHistoryEntry {
  const event = mapEvent(row);
  return { ...event, beforeIntervalDays: event.beforeState?.intervalDays ?? null, afterIntervalDays: event.afterState.intervalDays, resultingNextReviewAt: event.afterState.nextReviewAt };
}

function cadenceStateOf(cadence: CardCadence): CadenceState {
  return { nextReviewAt: cadence.nextReviewAt, intervalDays: cadence.intervalDays, reviewCount: cadence.reviewCount, lapseCount: cadence.lapseCount };
}

export const reviewRouter = t.router({
  rate: protectedProcedure.input(ReviewRateInputSchema).output(ReviewRateOutputSchema).mutation(async ({ ctx, input }) => {
    const now = ctx.now;
    let reviewId: string;
    try {
      reviewId = await ctx.db.transaction(async (tx) => {
        await requireDeck(tx, ctx.identity.userId, input.deckId);
        const cadenceRows = await cardCadencesOwnedBy(tx, ctx.identity.userId).where(and(eq(cardCadences.id, input.cadenceId), eq(decks.id, input.deckId))).limit(1).for('update', { of: cardCadences });
        if (cadenceRows.length === 0) throw new ApplicationError('NOT_FOUND', 'Cadence not found');
        const cadence = mapCadence(cadenceRows[0].cadence);
        const existingRows = await reviewEventsOf(tx, ctx.identity.userId).where(and(eq(reviewEvents.cadenceId, input.cadenceId), eq(reviewEvents.requestId, input.requestId))).limit(1);
        if (existingRows.length > 0) return existingRows[0].event.id;
        if (cadence.version !== input.expectedVersion) throw new ApplicationError('CONFLICT', `Cadence changed since version ${input.expectedVersion}`);
        const beforeState = cadenceStateOf(cadence);
        const afterState = new Cadence().rate(beforeState, input.rating, now);
        let eventRows;
        try {
          eventRows = await tx.insert(reviewEvents).values({ cadenceId: input.cadenceId, rating: input.rating, reviewedAt: now.toISOString(), beforeState, afterState, requestId: input.requestId, createdAt: now.toISOString() }).returning();
        } catch (error) {
          if (isUniqueViolation(error)) throw new ReviewRequestExists(input.cadenceId, input.requestId);
          throw error;
        }
        await tx.update(cardCadences).set({ ...afterState, version: cadence.version + 1, updatedAt: now.toISOString() }).where(and(eq(cardCadences.id, input.cadenceId), eq(cardCadences.version, cadence.version)));
        return eventRows[0].id;
      });
    } catch (error) {
      if (!(error instanceof ReviewRequestExists)) throw error;
      const existingRows = await reviewEventsOf(ctx.db, ctx.identity.userId).where(and(eq(reviewEvents.cadenceId, input.cadenceId), eq(reviewEvents.requestId, input.requestId))).limit(1);
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
      const newerRows = await reviewEventsOf(tx, ctx.identity.userId).where(and(eq(reviewEvents.cadenceId, event.cadenceId), isNull(reviewEvents.undoneAt), or(gt(reviewEvents.reviewedAt, event.reviewedAt), and(eq(reviewEvents.reviewedAt, event.reviewedAt), gt(reviewEvents.id, event.id))))).limit(1);
      if (newerRows.length > 0) throw new ApplicationError('INVALID_STATE', 'Only the latest active review can be undone');
      const beforeState = event.beforeState ?? { nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 };
      await tx.update(reviewEvents).set({ undoneAt: now.toISOString() }).where(eq(reviewEvents.id, event.id));
      await tx.update(cardCadences).set({ ...beforeState, version: eventRows[0].cadence.version + 1, updatedAt: now.toISOString() }).where(eq(cardCadences.id, event.cadenceId));
    });
    return { queue: await queueSnapshot(ctx.db, ctx.identity.userId, input.deckId, input.queue, now) };
  }),
  history: protectedProcedure.input(ReviewHistoryInputSchema).output(ReviewHistoryOutputSchema).query(async ({ ctx, input }) => {
    await requireDeck(ctx.db, ctx.identity.userId, input.deckId);
    const after = input.pagination.cursor ? decodeCursor(input.pagination.cursor) : null;
    const conditions: (SQL | undefined)[] = [eq(reviewEvents.cadenceId, input.cadenceId), eq(decks.id, input.deckId)];
    if (after) conditions.push(or(lt(reviewEvents.reviewedAt, after.timestamp), and(eq(reviewEvents.reviewedAt, after.timestamp), lt(reviewEvents.id, after.id))));
    const rows = await reviewEventsOf(ctx.db, ctx.identity.userId).where(and(...conditions)).orderBy(desc(reviewEvents.reviewedAt), desc(reviewEvents.id)).limit(input.pagination.limit + 1);
    const values = rows.map(({ event }) => mapHistory(event));
    const pageItems = values.length > input.pagination.limit ? values.slice(0, input.pagination.limit) : values;
    return { events: pageItems, pageInfo: { nextCursor: values.length > input.pagination.limit ? encodeCursor(pageItems.at(-1)!.reviewedAt, pageItems.at(-1)!.id) : null } };
  }),
});
