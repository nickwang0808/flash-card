import { z } from 'zod';
import { CardContentSchema } from './Card.ts';
import { TimestampSchema, UuidSchema } from './primitives.ts';

export const RevisionEventTypeSchema = z.enum(['created', 'edited', 'restored', 'ai_generated']);

export const CardRevisionSchema = z.object({
  id: UuidSchema,
  cardId: UuidSchema,
  eventType: RevisionEventTypeSchema,
  beforeContent: CardContentSchema.nullable(),
  afterContent: CardContentSchema,
  createdAt: TimestampSchema,
});

export type CardRevision = z.output<typeof CardRevisionSchema>;
