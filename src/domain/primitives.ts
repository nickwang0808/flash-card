import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const RatingSchema = z.enum(['again', 'hard', 'good', 'easy']);

export type Rating = z.output<typeof RatingSchema>;

export function toIsoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Database returned an invalid timestamp');
  return timestamp.toISOString();
}
