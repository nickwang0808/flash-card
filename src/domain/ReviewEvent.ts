import { z } from 'zod';
import { CadenceStateSchema } from './CadenceState.ts';
import { RatingSchema, TimestampSchema } from './primitives.ts';

const ReviewEventFields = {
  id: z.string().uuid(),
  cadenceId: z.string().uuid(),
  rating: RatingSchema,
  reviewedAt: TimestampSchema,
  beforeState: CadenceStateSchema.nullable(),
  afterState: CadenceStateSchema,
  requestId: z.string().uuid(),
  undoneAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
};

export const ReviewEventSchema = z.object(ReviewEventFields);

export const ReviewHistoryEntrySchema = ReviewEventSchema.extend({
  beforeIntervalDays: z.number().finite().positive().nullable(),
  afterIntervalDays: z.number().finite().positive().nullable(),
  resultingNextReviewAt: TimestampSchema.nullable(),
});

export type ReviewEvent = z.output<typeof ReviewEventSchema>;
export type ReviewHistoryEntry = z.output<typeof ReviewHistoryEntrySchema>;
