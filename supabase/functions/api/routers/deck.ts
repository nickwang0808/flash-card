import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { DeckSchema } from '../../../../src/domain/Deck.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { QueueOptionsSchema, QueueSnapshotSchema, StudyQueue, type QueueOptions } from '../../../../src/domain/StudyQueue.ts';
import { UuidSchema, toIsoTimestamp } from '../../../../src/domain/primitives.ts';
import { cards, decks } from '../../../../src/db/schema.ts';
import { cardsOwnedBy, decksOwnedBy, requireDeck } from '../../../../src/db/tenant.ts';
import { protectedProcedure, t } from '../trpc.ts';

const DeckListInputSchema = z.object({});
const DeckCreateInputSchema = z.object({ name: z.string().trim().min(1).max(200), defaultSpeechLocale: z.string().trim().max(35).nullable().default(null) });
const DeckRenameInputSchema = z.object({ deckId: UuidSchema, name: z.string().trim().min(1).max(200), expectedVersion: z.number().int().nonnegative() });
const DeckRemoveInputSchema = z.object({ deckId: UuidSchema, expectedVersion: z.number().int().nonnegative(), confirmation: z.literal(true) });
const DeckQueueInputSchema = z.object({ deckId: UuidSchema }).and(QueueOptionsSchema);
const DeckListOutputSchema = z.object({ decks: z.array(DeckSchema) });
const DeckRemoveOutputSchema = z.object({ removed: z.literal(true) });

function mapDeck(row: typeof decks.$inferSelect) {
  return { id: row.id, name: row.name, defaultSpeechLocale: row.defaultSpeechLocale, createdAt: toIsoTimestamp(row.createdAt), updatedAt: toIsoTimestamp(row.updatedAt), version: row.version };
}
function mapCard(row: typeof cards.$inferSelect) {
  return { id: row.id, deckId: row.deckId, name: row.name, frontMarkdown: row.frontMarkdown, backMarkdown: row.backMarkdown, speechText: row.speechText, speechLocale: row.speechLocale, tags: row.tags, suspended: row.suspended, createdAt: toIsoTimestamp(row.createdAt), updatedAt: toIsoTimestamp(row.updatedAt), cadencePhase: row.cadencePhase, nextReviewAt: row.nextReviewAt ? toIsoTimestamp(row.nextReviewAt) : null, intervalDays: row.intervalDays, reviewCount: row.reviewCount, lapseCount: row.lapseCount, schedulerVersion: row.schedulerVersion, version: row.version };
}

async function queueSnapshot(db: Parameters<typeof cardsOwnedBy>[0], userId: string, deckId: string, options: QueueOptions, now: Date) {
  const horizon = new Date(now.getTime() + options.horizonHours * 3_600_000).toISOString();
  const [newRows, reviewedRows] = await Promise.all([
    cardsOwnedBy(db, userId).where(and(eq(cards.deckId, deckId), eq(cards.suspended, false), isNull(cards.nextReviewAt))).orderBy(asc(cards.createdAt), asc(cards.id)).limit(options.limit),
    cardsOwnedBy(db, userId).where(and(eq(cards.deckId, deckId), eq(cards.suspended, false), isNotNull(cards.nextReviewAt), lte(cards.nextReviewAt, horizon))).orderBy(asc(cards.nextReviewAt), asc(cards.id)).limit(options.limit),
  ]);
  return new StudyQueue().build([...newRows.map(({ cards: card }) => mapCard(card)), ...reviewedRows.map(({ cards: card }) => mapCard(card))], now, options);
}

const UNIQUE_VIOLATION = '23505';
function isUniqueViolation(error: unknown): boolean {
  const candidate = typeof error === 'object' && error !== null && 'cause' in error && error.cause !== undefined ? error.cause : error;
  return typeof candidate === 'object' && candidate !== null && 'code' in candidate && candidate.code === UNIQUE_VIOLATION;
}

export const deckRouter = t.router({
  list: protectedProcedure.input(DeckListInputSchema).output(DeckListOutputSchema).query(async ({ ctx }) => {
    const rows = await decksOwnedBy(ctx.db, ctx.identity.userId).orderBy(asc(decks.name), asc(decks.id));
    return { decks: rows.map(mapDeck) };
  }),
  create: protectedProcedure.input(DeckCreateInputSchema).output(DeckSchema).mutation(async ({ ctx, input }) => {
    try {
      const timestamp = ctx.now.toISOString();
      const rows = await ctx.db.insert(decks).values({ userId: ctx.identity.userId, name: input.name, defaultSpeechLocale: input.defaultSpeechLocale, createdAt: timestamp, updatedAt: timestamp }).returning();
      return mapDeck(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApplicationError('CONFLICT', `A deck named "${input.name}" already exists`);
      throw error;
    }
  }),
  rename: protectedProcedure.input(DeckRenameInputSchema).output(DeckSchema).mutation(async ({ ctx, input }) => {
    try {
      const rows = await ctx.db.update(decks).set({ name: input.name, version: input.expectedVersion + 1, updatedAt: ctx.now.toISOString() }).where(and(eq(decks.id, input.deckId), eq(decks.userId, ctx.identity.userId), eq(decks.version, input.expectedVersion))).returning();
      if (rows.length === 0) {
        await requireDeck(ctx.db, ctx.identity.userId, input.deckId);
        throw new ApplicationError('CONFLICT', `Deck changed since version ${input.expectedVersion}`);
      }
      return mapDeck(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApplicationError('CONFLICT', `A deck named "${input.name}" already exists`);
      throw error;
    }
  }),
  remove: protectedProcedure.input(DeckRemoveInputSchema).output(DeckRemoveOutputSchema).mutation(async ({ ctx, input }) => {
    const rows = await ctx.db.delete(decks).where(and(eq(decks.id, input.deckId), eq(decks.userId, ctx.identity.userId), eq(decks.version, input.expectedVersion))).returning({ id: decks.id });
    if (rows.length === 0) {
      await requireDeck(ctx.db, ctx.identity.userId, input.deckId);
      throw new ApplicationError('CONFLICT', `Deck changed since version ${input.expectedVersion}`);
    }
    return { removed: true as const };
  }),
  queue: protectedProcedure.input(DeckQueueInputSchema).output(QueueSnapshotSchema).query(async ({ ctx, input }) => {
    await requireDeck(ctx.db, ctx.identity.userId, input.deckId);
    return queueSnapshot(ctx.db, ctx.identity.userId, input.deckId, input, ctx.now);
  }),
});
