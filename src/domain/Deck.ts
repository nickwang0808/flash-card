import { z } from 'zod';
import { deckBaseSchema } from '../db/zod.ts';

export const DeckSchema = deckBaseSchema.omit({ userId: true }).extend({
  name: z.string().trim().min(1).max(200),
  defaultSpeechLocale: z.string().trim().max(35).nullable(),
  version: z.number().int().nonnegative(),
});

export type Deck = z.output<typeof DeckSchema>;
