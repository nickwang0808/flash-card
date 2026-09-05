import { z } from 'zod';
import { CardContentSchema } from './Card.ts';
import { cardRevisionBaseSchema } from '../db/zod.ts';

export const RevisionEventTypeSchema = cardRevisionBaseSchema.shape.eventType;

export const CardRevisionSchema = cardRevisionBaseSchema.extend({
  beforeContent: CardContentSchema.nullable(),
  afterContent: CardContentSchema,
});

export type CardRevision = z.output<typeof CardRevisionSchema>;
