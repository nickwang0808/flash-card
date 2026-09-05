import { z } from 'zod';
import { CardSchema, CardContentSchema, CardNameSchema, MarkdownSchema } from '../../domain/Card';
import { CardRevisionSchema } from '../../domain/CardRevision';
import { QueueOptionsSchema } from '../../domain/StudyQueue';
import { UuidSchema } from '../../domain/primitives';
import { PaginationInputSchema, PageInfoSchema } from '../pagination';
import { ExpectedVersionSchema, ConfirmationSchema, ReplacementQueueSchema } from './common';

const CardMutationContentSchema = CardContentSchema.extend({
  tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
});

export const CardGetInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema });
export const CardGetOutputSchema = CardSchema;
export const CardSearchInputSchema = z.object({
  deckId: UuidSchema.nullable().optional(),
  query: z.string().trim().min(1).max(500),
  pagination: PaginationInputSchema,
});
export const CardSearchOutputSchema = z.object({ cards: z.array(CardSchema), pageInfo: PageInfoSchema });
export const CardCreateInputSchema = z.object({
  deckId: UuidSchema,
  name: CardNameSchema,
  frontMarkdown: MarkdownSchema,
  backMarkdown: MarkdownSchema,
  tags: CardMutationContentSchema.shape.tags,
  speechText: CardMutationContentSchema.shape.speechText.default(null),
  speechLocale: CardMutationContentSchema.shape.speechLocale.default(null),
});
export const CardCreateOutputSchema = CardSchema;
export const CardUpdateInputSchema = CardCreateInputSchema.extend({
  cardId: UuidSchema,
  expectedVersion: ExpectedVersionSchema,
});
export const CardUpdateOutputSchema = CardSchema;
export const CardSuspendInputSchema = z.object({
  cardId: UuidSchema,
  deckId: UuidSchema,
  expectedVersion: ExpectedVersionSchema,
  queue: QueueOptionsSchema,
});
export const CardSuspendOutputSchema = ReplacementQueueSchema;
export const CardRestoreInputSchema = CardSuspendInputSchema;
export const CardRestoreOutputSchema = z.object({ card: CardSchema, queue: ReplacementQueueSchema.shape.queue });
export const CardRemoveInputSchema = z.object({
  cardId: UuidSchema,
  deckId: UuidSchema,
  expectedVersion: ExpectedVersionSchema,
  confirmation: ConfirmationSchema,
  queue: QueueOptionsSchema,
});
export const CardRemoveOutputSchema = ReplacementQueueSchema;
export const CardRevisionsInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, pagination: PaginationInputSchema });
export const CardRevisionsOutputSchema = z.object({ revisions: z.array(CardRevisionSchema), pageInfo: PageInfoSchema });
export const CardRollbackRevisionInputSchema = z.object({
  cardId: UuidSchema,
  deckId: UuidSchema,
  revisionId: UuidSchema,
  expectedVersion: ExpectedVersionSchema,
});
export const CardRollbackRevisionOutputSchema = CardSchema;
