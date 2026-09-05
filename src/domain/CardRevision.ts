import { z } from 'zod';
import { CardContentSchema } from './Card';
import { TimestampSchema, UuidSchema } from './primitives';

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
