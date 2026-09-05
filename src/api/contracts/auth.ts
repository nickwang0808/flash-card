import { z } from 'zod';
import { TimestampSchema, UuidSchema } from '../../domain/primitives.ts';

export const AuthSessionInputSchema = z.object({});
export const AuthSessionOutputSchema = z.object({
  userId: UuidSchema,
  email: z.string().email().nullable(),
  issuedAt: TimestampSchema.nullable(),
  expiresAt: TimestampSchema.nullable(),
});
