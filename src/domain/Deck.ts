import { z } from 'zod';
import { TimestampSchema, UuidSchema } from './primitives';

export const DeckSchema = z.object({
  id: UuidSchema,
  name: z.string().trim().min(1).max(200),
  defaultSpeechLocale: z.string().trim().max(35).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().nonnegative(),
});

export type Deck = z.output<typeof DeckSchema>;
