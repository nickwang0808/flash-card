import { t } from './trpc.ts';
import { authRouter } from './routers/auth.ts';
import { cardRouter } from './routers/card.ts';
import { deckRouter } from './routers/deck.ts';
import { reviewRouter } from './routers/review.ts';

export const appRouter = t.router({
  auth: authRouter,
  deck: deckRouter,
  card: cardRouter,
  review: reviewRouter,
});

export type AppRouter = typeof appRouter;
