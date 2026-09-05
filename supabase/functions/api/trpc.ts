import { initTRPC, TRPCError } from '@trpc/server';
import { ApplicationError, toTRPCErrorCode } from '../../../src/domain/errors.ts';
import type { AppDb } from '../../../src/db/client.ts';
import type { VerifiedIdentity } from './identity.ts';

export interface ApiContext {
  identity: VerifiedIdentity;
  db: AppDb;
}

const t = initTRPC.context<ApiContext>().create({
  errorFormatter({ error, shape }) {
    const cause = rootCause(error.cause);
    const applicationError = cause instanceof ApplicationError ? cause : null;
    return {
      ...shape,
      message: applicationError?.message ?? shape.message,
      data: {
        ...shape.data,
        code: applicationError ? toTRPCErrorCode(applicationError.code) : shape.data.code,
        applicationCode: applicationError?.code,
      },
    };
  },
});

function rootCause(error: unknown): unknown {
  let current = error;
  while (current instanceof Error && 'cause' in current && current.cause !== undefined && current.cause !== null) {
    current = current.cause;
  }
  return current;
}

const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.identity.userId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  return next({ ctx });
});
const mapApplicationErrors = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw new TRPCError({ code: toTRPCErrorCode(error.code) as TRPCError['code'], message: error.message, cause: error });
    }
    throw error;
  }
});

export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(requireAuth).use(mapApplicationErrors);
export { t };
