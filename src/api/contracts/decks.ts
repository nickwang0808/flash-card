import { z } from 'zod';
import { DeckSchema } from '../../domain/Deck';
import { QueueOptionsSchema, QueueSnapshotSchema } from '../../domain/StudyQueue';
import { UuidSchema } from '../../domain/primitives';
import { ExpectedVersionSchema, ConfirmationSchema } from './common';

export const DeckListInputSchema = z.object({});
export const DeckListOutputSchema = z.object({ decks: z.array(DeckSchema) });
export const DeckCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  defaultSpeechLocale: z.string().trim().max(35).nullable().default(null),
});
export const DeckCreateOutputSchema = DeckSchema;
export const DeckRenameInputSchema = z.object({
  deckId: UuidSchema,
  name: z.string().trim().min(1).max(200),
  expectedVersion: ExpectedVersionSchema,
});
export const DeckRenameOutputSchema = DeckSchema;
export const DeckRemoveInputSchema = z.object({
  deckId: UuidSchema,
  expectedVersion: ExpectedVersionSchema,
  confirmation: ConfirmationSchema,
});
export const DeckRemoveOutputSchema = z.object({ removed: z.literal(true) });
export const DeckQueueInputSchema = z.object({ deckId: UuidSchema }).and(QueueOptionsSchema);
export const DeckQueueOutputSchema = QueueSnapshotSchema;
