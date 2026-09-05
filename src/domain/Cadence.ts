import { ApplicationError } from './errors';
import type { CadenceState } from './CadenceState';
import type { Rating } from './primitives';

export const CADENCE_V1 = Object.freeze({
  schedulerVersion: 1,
  againMinutes: 1,
  hardLearningMinutes: 10,
  firstGoodDays: 1,
  firstEasyDays: 4,
  lapseMultiplier: 0.5,
  hardMultiplier: 1.2,
  goodMultiplier: 2,
  easyMultiplier: 3,
  maximumIntervalDays: 365,
} as const);

export class Cadence {
  readonly config = CADENCE_V1;

  rate(state: CadenceState, rating: Rating, now: Date): CadenceState {
    const nowTime = now.getTime();
    if (!Number.isFinite(nowTime)) {
      throw new ApplicationError('VALIDATION_FAILED', 'Cadence time must be a valid date');
    }

    const reviewCount = state.reviewCount + 1;
    const base = {
      reviewCount,
      lapseCount: state.lapseCount,
      schedulerVersion: CADENCE_V1.schedulerVersion,
    } as const;

    if (state.cadencePhase === null) {
      return this.rateNewCard(rating, nowTime, base);
    }

    if (state.intervalDays === null || state.nextReviewAt === null || state.schedulerVersion === null) {
      throw new ApplicationError('INVALID_STATE', 'Studied cards must have complete cadence state');
    }

    if (state.cadencePhase === 'learning') {
      return this.rateLearningCard(state, rating, nowTime, base);
    }

    return this.rateReviewCard(state, rating, nowTime, base);
  }

  private rateNewCard(
    rating: Rating,
    nowTime: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount' | 'schedulerVersion'>,
  ): CadenceState {
    switch (rating) {
      case 'again':
        return this.learningState(nowTime, CADENCE_V1.againMinutes / 1440, base);
      case 'hard':
        return this.learningState(nowTime, 1, base, CADENCE_V1.hardLearningMinutes);
      case 'good':
        return this.reviewState(nowTime, CADENCE_V1.firstGoodDays, base);
      case 'easy':
        return this.reviewState(nowTime, CADENCE_V1.firstEasyDays, base);
    }
  }

  private rateLearningCard(
    state: CadenceState,
    rating: Rating,
    nowTime: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount' | 'schedulerVersion'>,
  ): CadenceState {
    const retainedInterval = state.intervalDays ?? 1;
    switch (rating) {
      case 'again':
        return this.learningState(nowTime, retainedInterval, base);
      case 'hard':
        return this.learningState(nowTime, retainedInterval, base, CADENCE_V1.hardLearningMinutes);
      case 'good':
        return this.reviewState(nowTime, retainedInterval, base);
      case 'easy':
        return this.reviewState(nowTime, Math.max(4, retainedInterval), base);
    }
  }

  private rateReviewCard(
    state: CadenceState,
    rating: Rating,
    nowTime: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount' | 'schedulerVersion'>,
  ): CadenceState {
    const oldInterval = state.intervalDays ?? 1;
    switch (rating) {
      case 'again':
        return this.learningState(
          nowTime,
          Math.max(1, oldInterval * CADENCE_V1.lapseMultiplier),
          { ...base, lapseCount: state.lapseCount + 1 },
        );
      case 'hard':
        return this.reviewState(nowTime, Math.max(1, oldInterval * CADENCE_V1.hardMultiplier), base);
      case 'good':
        return this.reviewState(nowTime, Math.max(1, oldInterval * CADENCE_V1.goodMultiplier), base);
      case 'easy':
        return this.reviewState(nowTime, Math.max(4, oldInterval * CADENCE_V1.easyMultiplier), base);
    }
  }

  private learningState(
    nowTime: number,
    intervalDays: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount' | 'schedulerVersion'>,
    dueMinutes: number = CADENCE_V1.againMinutes,
  ): CadenceState {
    return Object.freeze({
      cadencePhase: 'learning',
      nextReviewAt: new Date(nowTime + dueMinutes * 60_000).toISOString(),
      intervalDays: this.clampInterval(intervalDays),
      ...base,
    });
  }

  private reviewState(
    nowTime: number,
    intervalDays: number,
    base: Pick<CadenceState, 'reviewCount' | 'lapseCount' | 'schedulerVersion'>,
  ): CadenceState {
    const clampedInterval = this.clampInterval(intervalDays);
    return Object.freeze({
      cadencePhase: 'review',
      nextReviewAt: new Date(nowTime + clampedInterval * 86_400_000).toISOString(),
      intervalDays: clampedInterval,
      ...base,
    });
  }

  private clampInterval(intervalDays: number): number {
    return Math.min(CADENCE_V1.maximumIntervalDays, Math.max(1, intervalDays));
  }
}
