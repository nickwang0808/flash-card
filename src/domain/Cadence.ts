import { z } from 'zod';

import { CadenceStateSchema } from './CadenceState.ts';
import { TimestampSchema } from './primitives.ts';

const CadenceDirectionSchema = z.enum(['forward', 'reverse']);
export const CardCadenceSchema = CadenceStateSchema.extend({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  direction: CadenceDirectionSchema,
  version: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type CardCadence = z.output<typeof CardCadenceSchema>;
import { ApplicationError } from './errors.ts';
import type { CadenceState } from './CadenceState.ts';
import type { Rating } from './primitives.ts';

export class Cadence {
  rate(state: CadenceState, rating: Rating, now: Date): CadenceState {
    const nowTime = now.getTime();
    if (!Number.isFinite(nowTime)) {
      throw new ApplicationError('VALIDATION_FAILED', 'Cadence time must be a valid date');
    }

    const isNew = state.nextReviewAt === null && state.intervalDays === null;
    const isStudied = state.nextReviewAt !== null && state.intervalDays !== null;
    if (!isNew && !isStudied) {
      throw new ApplicationError('INVALID_STATE', 'Scheduling fields must be all null for new cards or all populated for studied cards');
    }

    const base = {
      reviewCount: state.reviewCount + 1,
      lapseCount: state.lapseCount,
    } as const;

    return isNew
      ? this.rateNewCard(rating, nowTime, base)
      : this.rateStudiedCard(state.intervalDays!, rating, nowTime, base);
  }

  private rateNewCard(
    rating: Rating,
    nowTime: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount'>,
  ): CadenceState {
    switch (rating) {
      case 'again':
        return this.scheduledState(nowTime, 1, base, 1);
      case 'hard':
        return this.scheduledState(nowTime, 1, base, 10);
      case 'good':
        return this.scheduledState(nowTime, 1, base);
      case 'easy':
        return this.scheduledState(nowTime, 7, base);
    }
  }

  private rateStudiedCard(
    oldIntervalDays: number,
    rating: Rating,
    nowTime: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount'>,
  ): CadenceState {
    switch (rating) {
      case 'again':
        return this.scheduledState(
          nowTime,
          Math.max(1, oldIntervalDays * 0.5),
          { ...base, lapseCount: base.lapseCount + 1 },
          1,
        );
      case 'hard':
        return this.scheduledState(nowTime, Math.max(1, oldIntervalDays * 1.2), base);
      case 'good':
        return this.scheduledState(nowTime, Math.max(1, oldIntervalDays * 2), base);
      case 'easy':
        return this.scheduledState(nowTime, Math.max(7, oldIntervalDays * 4), base);
    }
  }

  private scheduledState(
    nowTime: number,
    intervalDays: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount'>,
    dueMinutes?: number,
  ): CadenceState {
    const clampedInterval = this.clampInterval(intervalDays);
    const dueMilliseconds = dueMinutes === undefined
      ? clampedInterval * 86_400_000
      : dueMinutes * 60_000;
    return Object.freeze({
      nextReviewAt: new Date(nowTime + dueMilliseconds).toISOString(),
      intervalDays: clampedInterval,
      ...base,
    });
  }

  private clampInterval(intervalDays: number): number {
    return Math.min(365, Math.max(1, intervalDays));
  }
}
