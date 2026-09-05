import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const RatingSchema = z.enum(['again', 'hard', 'good', 'easy']);
export const CadencePhaseSchema = z.enum(['learning', 'review']);

export type Rating = z.output<typeof RatingSchema>;
export type CadencePhase = z.output<typeof CadencePhaseSchema>;

export function toIsoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Database returned an invalid timestamp');
  return timestamp.toISOString();
}
