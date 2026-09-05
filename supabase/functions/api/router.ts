import { AuthSessionInputSchema, AuthSessionOutputSchema } from '../../../src/api/contracts/auth.ts';
import { DeckCreateInputSchema, DeckCreateOutputSchema, DeckListInputSchema, DeckListOutputSchema, DeckQueueInputSchema, DeckQueueOutputSchema, DeckRemoveInputSchema, DeckRemoveOutputSchema, DeckRenameInputSchema, DeckRenameOutputSchema } from '../../../src/api/contracts/decks.ts';
import { CardCreateInputSchema, CardCreateOutputSchema, CardGetInputSchema, CardGetOutputSchema, CardRemoveInputSchema, CardRemoveOutputSchema, CardRestoreInputSchema, CardRestoreOutputSchema, CardRevisionsInputSchema, CardRevisionsOutputSchema, CardRollbackRevisionInputSchema, CardRollbackRevisionOutputSchema, CardSearchInputSchema, CardSearchOutputSchema, CardSuspendInputSchema, CardSuspendOutputSchema, CardUpdateInputSchema, CardUpdateOutputSchema } from '../../../src/api/contracts/cards.ts';
import { ReviewHistoryInputSchema, ReviewHistoryOutputSchema, ReviewRateInputSchema, ReviewRateOutputSchema, ReviewUndoInputSchema, ReviewUndoOutputSchema } from '../../../src/api/contracts/reviews.ts';
import { guard, protectedProcedure, publicProcedure, t } from './trpc.ts';

export const appRouter = t.router({
  auth: t.router({
    session: publicProcedure
      .input(AuthSessionInputSchema)
      .output(AuthSessionOutputSchema)
      .query(({ ctx }) => ctx.identity),
  }),
  deck: t.router({
    list: protectedProcedure
      .input(DeckListInputSchema)
      .output(DeckListOutputSchema)
      .query(guard(async ({ ctx }) => ({ decks: await ctx.services.decks.list() }))),
    create: protectedProcedure
      .input(DeckCreateInputSchema)
      .output(DeckCreateOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ctx.services.decks.create(input))),
    rename: protectedProcedure
      .input(DeckRenameInputSchema)
      .output(DeckRenameOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ctx.services.decks.rename(input))),
    remove: protectedProcedure
      .input(DeckRemoveInputSchema)
      .output(DeckRemoveOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ctx.services.decks.remove(input))),
    queue: protectedProcedure
      .input(DeckQueueInputSchema)
      .output(DeckQueueOutputSchema)
      .query(guard(async ({ ctx, input }) => ctx.services.study.getQueue({ deckId: input.deckId, options: input }))),
  }),
  card: t.router({
    get: protectedProcedure
      .input(CardGetInputSchema)
      .output(CardGetOutputSchema)
      .query(guard(async ({ ctx, input }) => ctx.services.cards.get(input))),
    search: protectedProcedure
      .input(CardSearchInputSchema)
      .output(CardSearchOutputSchema)
      .query(guard(async ({ ctx, input }) =>
        ctx.services.cards.search({ deckId: input.deckId ?? null, query: input.query, pagination: input.pagination }),
      )),
    create: protectedProcedure
      .input(CardCreateInputSchema)
      .output(CardCreateOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ctx.services.cards.create({
        deckId: input.deckId,
        content: {
          name: input.name,
          frontMarkdown: input.frontMarkdown,
          backMarkdown: input.backMarkdown,
          speechText: input.speechText,
          speechLocale: input.speechLocale,
        },
        tags: input.tags,
      }))),
    update: protectedProcedure
      .input(CardUpdateInputSchema)
      .output(CardUpdateOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ctx.services.cards.update({
        cardId: input.cardId,
        deckId: input.deckId,
        expectedVersion: input.expectedVersion,
        content: {
          name: input.name,
          frontMarkdown: input.frontMarkdown,
          backMarkdown: input.backMarkdown,
          speechText: input.speechText,
          speechLocale: input.speechLocale,
        },
        tags: input.tags,
      }))),
    suspend: protectedProcedure
      .input(CardSuspendInputSchema)
      .output(CardSuspendOutputSchema)
      .mutation(guard(async ({ ctx, input }) => {
        await ctx.services.cards.suspend(input);
        return { queue: await ctx.services.study.getQueue({ deckId: input.deckId, options: input.queue }) };
      })),
    restore: protectedProcedure
      .input(CardRestoreInputSchema)
      .output(CardRestoreOutputSchema)
      .mutation(guard(async ({ ctx, input }) => {
        const card = await ctx.services.cards.restore(input);
        const queue = await ctx.services.study.getQueue({ deckId: input.deckId, options: input.queue });
        return { card, queue };
      })),
    remove: protectedProcedure
      .input(CardRemoveInputSchema)
      .output(CardRemoveOutputSchema)
      .mutation(guard(async ({ ctx, input }) => {
        await ctx.services.cards.remove(input);
        return { queue: await ctx.services.study.getQueue({ deckId: input.deckId, options: input.queue }) };
      })),
    revisions: protectedProcedure
      .input(CardRevisionsInputSchema)
      .output(CardRevisionsOutputSchema)
      .query(guard(async ({ ctx, input }) => ctx.services.cards.revisions(input))),
    rollbackRevision: protectedProcedure
      .input(CardRollbackRevisionInputSchema)
      .output(CardRollbackRevisionOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ctx.services.cards.rollbackRevision(input))),
  }),
  review: t.router({
    rate: protectedProcedure
      .input(ReviewRateInputSchema)
      .output(ReviewRateOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ctx.services.study.rate(input))),
    history: protectedProcedure
      .input(ReviewHistoryInputSchema)
      .output(ReviewHistoryOutputSchema)
      .query(guard(async ({ ctx, input }) => ctx.services.study.getHistory(input))),
    undo: protectedProcedure
      .input(ReviewUndoInputSchema)
      .output(ReviewUndoOutputSchema)
      .mutation(guard(async ({ ctx, input }) => ({ queue: await ctx.services.study.undo(input) }))),
  }),
});

export type AppRouter = typeof appRouter;