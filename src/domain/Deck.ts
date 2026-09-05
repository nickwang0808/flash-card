import { z } from 'zod';
import { TimestampSchema } from './primitives.ts';

export const DeckSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  defaultSpeechLocale: z.string().trim().max(35).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().nonnegative(),
});

export type Deck = z.output<typeof DeckSchema>;
