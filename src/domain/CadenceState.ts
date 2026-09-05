import { z } from 'zod';
import { cardBaseSchema } from '../db/zod.ts';

export const CadenceStateFieldsSchema = cardBaseSchema
  .pick({
    cadencePhase: true,
    nextReviewAt: true,
    intervalDays: true,
    reviewCount: true,
    lapseCount: true,
    schedulerVersion: true,
  })
  .extend({
    intervalDays: z.number().finite().positive().nullable(),
    reviewCount: z.number().int().nonnegative(),
    lapseCount: z.number().int().nonnegative(),
    schedulerVersion: z.number().int().positive().nullable(),
  });

export const CadenceStateSchema = CadenceStateFieldsSchema.superRefine((state, context) => {
  const isNew = state.cadencePhase === null && state.nextReviewAt === null && state.intervalDays === null && state.schedulerVersion === null;
  const isStudied = state.cadencePhase !== null && state.nextReviewAt !== null && state.intervalDays !== null && state.schedulerVersion !== null;
  if (!isNew && !isStudied) {
    context.addIssue({ code: 'custom', message: 'Cadence fields must be all null for new cards or all populated for studied cards' });
  }
});

export type CadenceState = z.output<typeof CadenceStateSchema>;
