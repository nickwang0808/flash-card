import { initTRPC, TRPCError } from '@trpc/server';
import { ApplicationError, toTRPCErrorCode } from '../../../src/domain/errors.ts';
import type { VerifiedIdentity } from './identity.ts';
import type { CardService } from './services/CardService.ts';
import type { DeckService } from './services/DeckService.ts';
import type { StudyService } from './services/StudyService.ts';

/** Request context assembled by the edge entry point after JWT verification. */
export interface ApiContext {
  identity: VerifiedIdentity;
  services: Services;
}

export interface Services {
  decks: DeckService;
  cards: CardService;
  study: StudyService;
}

const t = initTRPC.context<ApiContext>().create({
  errorFormatter({ error, shape }) {
    const cause = rootCause(error.cause);
    return {
      ...shape,
      data: {
        ...shape.data,
        applicationCode: cause instanceof ApplicationError ? cause.code : undefined,
      },
    };
  },
});

/** tRPC wraps thrown errors in TRPCError; follow the cause chain to the root. */
function rootCause(error: unknown): unknown {
  let current = error;
  while (
    current instanceof Error &&
    'cause' in current &&
    (current as { cause?: unknown }).cause !== undefined &&
    (current as { cause?: unknown }).cause !== null
  ) {
    current = (current as { cause: unknown }).cause;
  }
  return current;
}

const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.identity.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
  return next({ ctx });
});

/**
 * Converts ApplicationError into itsits stable tRPC error code. Codes come from
 * the shared domain mapping; SQL details are never exposed.
 */
function mapError(error: unknown): never {
  if (error instanceof ApplicationError) {
    throw new TRPCError({
      code: toTRPCErrorCode(error.code) as TRPCError['code'],
      message: error.message,
      cause: error,
    });
  }
  throw error;
}

export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(requireAuth);

/** Wrap a handler so ApplicationError always maps to its stable tRPC code. */
export function guard<TArgs, TResult>(handler: (args: TArgs) => Promise<TResult> | TResult) {
  return async (args: TArgs): Promise<TResult> => {
    try {
      return await handler(args);
    } catch (error) {
      mapError(error);
    }
  };
}

export { t };