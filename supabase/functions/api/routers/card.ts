import { and, arrayContains, asc, desc, eq, ilike, isNotNull, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { CardContentSchema, CardNameSchema, CardSchema, MarkdownSchema, type Card, type CardContent } from '../../../../src/domain/Card.ts';
import { CardRevisionSchema, type CardRevision } from '../../../../src/domain/CardRevision.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { QueueOptionsSchema, QueueSnapshotSchema, StudyQueue, type QueueOptions } from '../../../../src/domain/StudyQueue.ts';
import { UuidSchema, toIsoTimestamp } from '../../../../src/domain/primitives.ts';
import { cardRevisions, cards } from '../../../../src/db/schema.ts';
import { cardsOwnedBy, decodeCursor, deckRevisionsOf, encodeCursor, requireDeck, requireDeckForCard } from '../../../../src/db/tenant.ts';
import { protectedProcedure, t } from '../trpc.ts';

const PaginationInputSchema = z.object({ cursor: z.string().min(1).max(500).nullable().optional(), limit: z.number().int().min(1).max(100).default(50) });
const PageInfoSchema = z.object({ nextCursor: z.string().min(1).max(500).nullable() });
const ExpectedVersionSchema = z.number().int().nonnegative();
const ConfirmationSchema = z.literal(true);
const ReplacementQueueSchema = z.object({ queue: QueueSnapshotSchema });
const CardMutationTagsSchema = z.array(z.string().trim().min(1).max(100)).max(100).default([]);
const CardGetInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema });
const CardSearchInputSchema = z.object({ deckId: UuidSchema.nullable().optional(), query: z.string().trim().min(1).max(500), pagination: PaginationInputSchema });
const CardCreateInputSchema = z.object({ deckId: UuidSchema, name: CardNameSchema, frontMarkdown: MarkdownSchema, backMarkdown: MarkdownSchema, tags: CardMutationTagsSchema, speechText: CardContentSchema.shape.speechText.default(null), speechLocale: CardContentSchema.shape.speechLocale.default(null) });
const CardUpdateInputSchema = CardCreateInputSchema.extend({ cardId: UuidSchema, expectedVersion: ExpectedVersionSchema });
const CardSuspendInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, expectedVersion: ExpectedVersionSchema, queue: QueueOptionsSchema });
const CardRemoveInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, expectedVersion: ExpectedVersionSchema, confirmation: ConfirmationSchema, queue: QueueOptionsSchema });
const CardRevisionsInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, pagination: PaginationInputSchema });
const CardRollbackRevisionInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, revisionId: UuidSchema, expectedVersion: ExpectedVersionSchema });
function mapCard(row: typeof cards.$inferSelect): Card {
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
function mapRevision(row: typeof cardRevisions.$inferSelect): CardRevision {
  return { id: row.id, cardId: row.cardId, eventType: row.eventType, beforeContent: row.beforeContent, afterContent: row.afterContent, createdAt: toIsoTimestamp(row.createdAt) };
}
function contentOf(card: Card): CardContent {
  return { name: card.name, frontMarkdown: card.frontMarkdown, backMarkdown: card.backMarkdown, speechText: card.speechText, speechLocale: card.speechLocale };
}
function beforeCardCursor(after: { timestamp: string; id: string }): SQL {
  return or(lt(cards.createdAt, after.timestamp), and(eq(cards.createdAt, after.timestamp), lt(cards.id, after.id)))!;
}
function beforeRevisionCursor(after: { timestamp: string; id: string }): SQL {
  return or(lt(cardRevisions.createdAt, after.timestamp), and(eq(cardRevisions.createdAt, after.timestamp), lt(cardRevisions.id, after.id)))!;
}
async function versionError(db: Parameters<typeof cardsOwnedBy>[0], userId: string, cardId: string, deckId: string, expectedVersion: number): Promise<ApplicationError> {
  const rows = await cardsOwnedBy(db, userId).where(and(eq(cards.id, cardId), eq(cards.deckId, deckId))).limit(1);
  return new ApplicationError(rows.length === 0 ? 'NOT_FOUND' : 'CONFLICT', rows.length === 0 ? 'Card not found' : `Card changed since version ${expectedVersion}`);
}
async function recordRevision(tx: Parameters<typeof cardsOwnedBy>[0], cardId: string, eventType: 'created' | 'edited' | 'restored' | 'ai_generated', beforeContent: CardContent | null, afterContent: CardContent, now: Date) {
  await tx.insert(cardRevisions).values({ cardId, eventType, beforeContent, afterContent, createdAt: now.toISOString() });
}

export const cardRouter = t.router({
  get: protectedProcedure.input(CardGetInputSchema).output(CardSchema).query(async ({ ctx, input }) => mapCard(await requireDeckForCard(ctx.db, ctx.identity.userId, input.cardId, input.deckId))),
  search: protectedProcedure.input(CardSearchInputSchema).output(z.object({ cards: z.array(CardSchema), pageInfo: PageInfoSchema })).query(async ({ ctx, input }) => {
    if (input.deckId !== null && input.deckId !== undefined) await requireDeck(ctx.db, ctx.identity.userId, input.deckId);
    const after = input.pagination.cursor ? decodeCursor(input.pagination.cursor) : null;
    const conditions: (SQL | undefined)[] = [or(ilike(cards.name, `%${input.query.toLowerCase()}%`), ilike(cards.frontMarkdown, `%${input.query.toLowerCase()}%`), ilike(cards.backMarkdown, `%${input.query.toLowerCase()}%`), arrayContains(cards.tags, [input.query]))];
    if (input.deckId) conditions.push(eq(cards.deckId, input.deckId));
    if (after) conditions.push(beforeCardCursor(after));
    const rows = await cardsOwnedBy(ctx.db, ctx.identity.userId).where(and(...conditions)).orderBy(desc(cards.createdAt), desc(cards.id)).limit(input.pagination.limit + 1);
    const items = rows.map(({ cards: row }) => mapCard(row));
    const hasMore = items.length > input.pagination.limit;
    const pageItems = hasMore ? items.slice(0, input.pagination.limit) : items;
    return { cards: pageItems, pageInfo: { nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1].createdAt, pageItems[pageItems.length - 1].id) : null } };
  }),
  create: protectedProcedure.input(CardCreateInputSchema).output(CardSchema).mutation(async ({ ctx, input }) => {
    await requireDeck(ctx.db, ctx.identity.userId, input.deckId);
    const content = { name: input.name, frontMarkdown: input.frontMarkdown, backMarkdown: input.backMarkdown, speechText: input.speechText, speechLocale: input.speechLocale };
    return ctx.db.transaction(async (tx) => {
      const timestamp = ctx.now.toISOString();
      const rows = await tx.insert(cards).values({ deckId: input.deckId, ...content, tags: input.tags, createdAt: timestamp, updatedAt: timestamp }).returning();
      const card = mapCard(rows[0]);
      await recordRevision(tx, card.id, 'created', null, content, ctx.now);
      return card;
    });
  }),
  update: protectedProcedure.input(CardUpdateInputSchema).output(CardSchema).mutation(async ({ ctx, input }) => {
    const content = { name: input.name, frontMarkdown: input.frontMarkdown, backMarkdown: input.backMarkdown, speechText: input.speechText, speechLocale: input.speechLocale };
    return ctx.db.transaction(async (tx) => {
      const before = mapCard(await requireDeckForCard(tx, ctx.identity.userId, input.cardId, input.deckId));
      if (before.version !== input.expectedVersion) throw new ApplicationError('CONFLICT', `Card changed since version ${input.expectedVersion}`);
      const rows = await tx.update(cards).set({ ...content, tags: input.tags, version: input.expectedVersion + 1, updatedAt: ctx.now.toISOString() }).where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion))).returning();
      if (rows.length === 0) throw await versionError(tx, ctx.identity.userId, input.cardId, input.deckId, input.expectedVersion);
      const card = mapCard(rows[0]);
      await recordRevision(tx, card.id, 'edited', contentOf(before), content, ctx.now);
      return card;
    });
  }),
  suspend: protectedProcedure.input(CardSuspendInputSchema).output(ReplacementQueueSchema).mutation(async ({ ctx, input }) => {
    await requireDeckForCard(ctx.db, ctx.identity.userId, input.cardId, input.deckId);
    const rows = await ctx.db.update(cards).set({ suspended: true, version: input.expectedVersion + 1, updatedAt: ctx.now.toISOString() }).where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion))).returning();
    if (rows.length === 0) throw await versionError(ctx.db, ctx.identity.userId, input.cardId, input.deckId, input.expectedVersion);
    return { queue: await queueSnapshot(ctx.db, ctx.identity.userId, input.deckId, input.queue, ctx.now) };
  }),
  restore: protectedProcedure.input(CardSuspendInputSchema).output(z.object({ card: CardSchema, queue: ReplacementQueueSchema.shape.queue })).mutation(async ({ ctx, input }) => {
    await requireDeckForCard(ctx.db, ctx.identity.userId, input.cardId, input.deckId);
    const rows = await ctx.db.update(cards).set({ suspended: false, version: input.expectedVersion + 1, updatedAt: ctx.now.toISOString() }).where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion))).returning();
    if (rows.length === 0) throw await versionError(ctx.db, ctx.identity.userId, input.cardId, input.deckId, input.expectedVersion);
    return { card: mapCard(rows[0]), queue: await queueSnapshot(ctx.db, ctx.identity.userId, input.deckId, input.queue, ctx.now) };
  }),
  remove: protectedProcedure.input(CardRemoveInputSchema).output(ReplacementQueueSchema).mutation(async ({ ctx, input }) => {
    await requireDeckForCard(ctx.db, ctx.identity.userId, input.cardId, input.deckId);
    const rows = await ctx.db.delete(cards).where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion))).returning({ id: cards.id });
    if (rows.length === 0) throw await versionError(ctx.db, ctx.identity.userId, input.cardId, input.deckId, input.expectedVersion);
    return { queue: await queueSnapshot(ctx.db, ctx.identity.userId, input.deckId, input.queue, ctx.now) };
  }),
  revisions: protectedProcedure.input(CardRevisionsInputSchema).output(z.object({ revisions: z.array(CardRevisionSchema), pageInfo: PageInfoSchema })).query(async ({ ctx, input }) => {
    await requireDeckForCard(ctx.db, ctx.identity.userId, input.cardId, input.deckId);
    const after = input.pagination.cursor ? decodeCursor(input.pagination.cursor) : null;
    const conditions: (SQL | undefined)[] = [eq(cardRevisions.cardId, input.cardId), eq(cards.deckId, input.deckId)];
    if (after) conditions.push(beforeRevisionCursor(after));
    const rows = await deckRevisionsOf(ctx.db, ctx.identity.userId).where(and(...conditions)).orderBy(desc(cardRevisions.createdAt), desc(cardRevisions.id)).limit(input.pagination.limit + 1);
    const items = rows.map(({ revision }) => mapRevision(revision));
    const hasMore = items.length > input.pagination.limit;
    const pageItems = hasMore ? items.slice(0, input.pagination.limit) : items;
    return { revisions: pageItems, pageInfo: { nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1].createdAt, pageItems[pageItems.length - 1].id) : null } };
  }),
  rollbackRevision: protectedProcedure.input(CardRollbackRevisionInputSchema).output(CardSchema).mutation(async ({ ctx, input }) => ctx.db.transaction(async (tx) => {
    const before = mapCard(await requireDeckForCard(tx, ctx.identity.userId, input.cardId, input.deckId));
    const rows = await deckRevisionsOf(tx, ctx.identity.userId).where(and(eq(cardRevisions.id, input.revisionId), eq(cardRevisions.cardId, input.cardId), eq(cards.deckId, input.deckId))).limit(1);
    if (rows.length === 0) throw new ApplicationError('NOT_FOUND', 'Revision not found');
    const revision = rows[0].revision;
    if (before.version !== input.expectedVersion) throw new ApplicationError('CONFLICT', `Card changed since version ${input.expectedVersion}`);
    const rowsUpdated = await tx.update(cards).set({ name: revision.afterContent.name, frontMarkdown: revision.afterContent.frontMarkdown, backMarkdown: revision.afterContent.backMarkdown, speechText: revision.afterContent.speechText, speechLocale: revision.afterContent.speechLocale, version: input.expectedVersion + 1, updatedAt: ctx.now.toISOString() }).where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion))).returning();
    if (rowsUpdated.length === 0) throw await versionError(tx, ctx.identity.userId, input.cardId, input.deckId, input.expectedVersion);
    const card = mapCard(rowsUpdated[0]);
    await recordRevision(tx, card.id, 'restored', contentOf(before), revision.afterContent, ctx.now);
    return card;
  })),
});

