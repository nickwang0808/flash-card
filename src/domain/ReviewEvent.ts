import { reviewEventBaseSchema } from '../db/zod.ts';
import { CadenceStateSchema } from './CadenceState.ts';
import { TimestampSchema } from './primitives.ts';
import { z } from 'zod';

export const ReviewEventSchema = reviewEventBaseSchema.extend({
  beforeState: CadenceStateSchema.nullable(),
  afterState: CadenceStateSchema,
});

export const ReviewHistoryEntrySchema = ReviewEventSchema.extend({
  beforeIntervalDays: z.number().finite().positive().nullable(),
  afterIntervalDays: z.number().finite().positive().nullable(),
  resultingNextReviewAt: TimestampSchema.nullable(),
});

export type ReviewEvent = z.output<typeof ReviewEventSchema>;
export type ReviewHistoryEntry = z.output<typeof ReviewHistoryEntrySchema>;
