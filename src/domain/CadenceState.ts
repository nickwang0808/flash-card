import { z } from 'zod';
import { TimestampSchema } from './primitives.ts';

const CadenceStateFieldsSchema = z.object({
  nextReviewAt: TimestampSchema.nullable(),
  intervalDays: z.number().finite().positive().nullable(),
  reviewCount: z.number().int().nonnegative(),
  lapseCount: z.number().int().nonnegative(),
});

export const CadenceStateSchema = CadenceStateFieldsSchema.superRefine((state, context) => {
  const isNew = state.nextReviewAt === null && state.intervalDays === null;
  const isStudied = state.nextReviewAt !== null && state.intervalDays !== null;
  if (!isNew && !isStudied) {
    context.addIssue({ code: 'custom', message: 'Scheduling fields must be all null for new cards or all populated for studied cards' });
  }
});

export type CadenceState = z.output<typeof CadenceStateSchema>;
