import { z } from 'zod';
import { TimestampSchema, UuidSchema } from '../../../../src/domain/primitives.ts';
import { publicProcedure, t } from '../trpc.ts';

const AuthSessionInputSchema = z.object({});
const AuthSessionOutputSchema = z.object({
  userId: UuidSchema,
  email: z.string().email().nullable(),
  issuedAt: TimestampSchema.nullable(),
  expiresAt: TimestampSchema.nullable(),
});

export const authRouter = t.router({
  session: publicProcedure.input(AuthSessionInputSchema).output(AuthSessionOutputSchema).query(({ ctx }) => ctx.identity),
});
