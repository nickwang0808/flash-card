import { z } from 'zod';
import { CadenceStateSchema } from './CadenceState.ts';
import { RatingSchema, TimestampSchema, UuidSchema } from './primitives.ts';

export const ReviewEventSchema = z.object({
  id: UuidSchema,
  cardId: UuidSchema,
  rating: RatingSchema,
  reviewedAt: TimestampSchema,
  beforeState: CadenceStateSchema.nullable(),
  afterState: CadenceStateSchema,
  requestId: UuidSchema,
  undoneAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export const ReviewHistoryEntrySchema = ReviewEventSchema.extend({
  beforeIntervalDays: z.number().finite().positive().nullable(),
  afterIntervalDays: z.number().finite().positive().nullable(),
  resultingNextReviewAt: TimestampSchema.nullable(),
});

export type ReviewEvent = z.output<typeof ReviewEventSchema>;
export type ReviewHistoryEntry = z.output<typeof ReviewHistoryEntrySchema>;
