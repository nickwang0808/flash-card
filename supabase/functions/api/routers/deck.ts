import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DeckSchema } from '../../../../src/domain/Deck.ts';
import { SpeechLocaleSchema } from '../../../../src/domain/Speech.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { QueueOptionsSchema, QueueSnapshotSchema } from '../../../../src/domain/StudyQueue.ts';
import { UuidSchema, toIsoTimestamp } from '../../../../src/domain/primitives.ts';
import { decks } from '../../../../src/db/schema.ts';
import { decksOwnedBy, requireDeck } from '../../../../src/db/tenant.ts';
import { queueSnapshot } from '../study-queue.ts';
import { protectedProcedure, t } from '../trpc.ts';

const DeckListInputSchema = z.object({});
const DeckCreateInputSchema = z.object({ name: z.string().trim().min(1).max(200), defaultSpeechLocale: SpeechLocaleSchema.nullable().default(null) });
const DeckRenameInputSchema = z.object({ deckId: UuidSchema, name: z.string().trim().min(1).max(200), expectedVersion: z.number().int().nonnegative() });
const DeckRemoveInputSchema = z.object({ deckId: UuidSchema, expectedVersion: z.number().int().nonnegative(), confirmation: z.literal(true) });
const DeckQueueInputSchema = z.object({ deckId: UuidSchema }).and(QueueOptionsSchema);
const DeckListOutputSchema = z.object({ decks: z.array(DeckSchema) });
const DeckRemoveOutputSchema = z.object({ removed: z.literal(true) });

function mapDeck(row: typeof decks.$inferSelect) {
  return { id: row.id, name: row.name, defaultSpeechLocale: row.defaultSpeechLocale, createdAt: toIsoTimestamp(row.createdAt), updatedAt: toIsoTimestamp(row.updatedAt), version: row.version };
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
