import { z } from 'zod';
import { CardContentSchema } from './Card.ts';
import { TimestampSchema } from './primitives.ts';

const RevisionEventTypeSchema = z.enum(['created', 'edited', 'restored', 'ai_generated']);

export const CardRevisionSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  eventType: RevisionEventTypeSchema,
  beforeContent: CardContentSchema.nullable(),
  afterContent: CardContentSchema,
  createdAt: TimestampSchema,
});

export type CardRevision = z.output<typeof CardRevisionSchema>;
