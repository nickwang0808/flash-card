import { describe, expect, it } from 'vitest';
import { CADENCE_V1, Cadence } from './Cadence';
import type { CadenceState } from './CadenceState';

const now = new Date('2026-01-01T00:00:00.000Z');
const newState: CadenceState = {
  cadencePhase: null,
  nextReviewAt: null,
  intervalDays: null,
  reviewCount: 0,
  lapseCount: 0,
  schedulerVersion: null,
};

const learningState: CadenceState = {
  cadencePhase: 'learning',
  nextReviewAt: '2026-01-01T00:10:00.000Z',
  intervalDays: 2,
  reviewCount: 3,
  lapseCount: 1,
  schedulerVersion: 1,
};

const reviewState: CadenceState = {
  cadencePhase: 'review',
  nextReviewAt: '2026-01-05T00:00:00.000Z',
  intervalDays: 10,
  reviewCount: 8,
  lapseCount: 2,
  schedulerVersion: 1,
};

function expectedDue(milliseconds: number): string {
  return new Date(now.getTime() + milliseconds).toISOString();
}

describe('Cadence v1', () => {
  const cadence = new Cadence();

  it.each([
    ['new again', newState, 'again', 'learning', 1, 1, 0, 1],
    ['new hard', newState, 'hard', 'learning', 1, 10, 0, 1],
    ['new good', newState, 'good', 'review', 1, 1440, 0, 1],
    ['new easy', newState, 'easy', 'review', 4, 5760, 0, 1],
    ['learning again', learningState, 'again', 'learning', 2, 1, 1, 4],
    ['learning hard', learningState, 'hard', 'learning', 2, 10, 1, 4],
    ['learning good', learningState, 'good', 'review', 2, 2880, 1, 4],
    ['learning easy', learningState, 'easy', 'review', 4, 5760, 1, 4],
    ['review again', reviewState, 'again', 'learning', 5, 1, 3, 9],
    ['review hard', reviewState, 'hard', 'review', 12, 17280, 2, 9],
    ['review good', reviewState, 'good', 'review', 20, 28800, 2, 9],
    ['review easy', reviewState, 'easy', 'review', 30, 43200, 2, 9],
  ] as const)('%s applies the exact transition', (_name, state, rating, phase, interval, dueMinutes, lapses, reviews) => {
    const result = cadence.rate(state, rating, now);
    expect(result).toMatchObject({
      cadencePhase: phase,
      intervalDays: interval,
      lapseCount: lapses,
      reviewCount: reviews,
      schedulerVersion: CADENCE_V1.schedulerVersion,
    });
    expect(result.nextReviewAt).toBe(expectedDue(dueMinutes * 60_000));
  });

  it('does not mutate the input state', () => {
    const before = structuredClone(reviewState);
    const result = cadence.rate(reviewState, 'good', now);
    expect(reviewState).toEqual(before);
    expect(result).not.toBe(reviewState);
  });

  it('clamps lower bounds for lapse and review multipliers', () => {
    const shortReview = { ...reviewState, intervalDays: 1 };
    expect(cadence.rate(shortReview, 'again', now).intervalDays).toBe(1);
    expect(cadence.rate(shortReview, 'hard', now).intervalDays).toBe(1.2);
    expect(cadence.rate(shortReview, 'easy', now).intervalDays).toBe(4);
  });

  it('clamps all intervals to the maximum', () => {
    const longReview = { ...reviewState, intervalDays: 364 };
    expect(cadence.rate(longReview, 'hard', now).intervalDays).toBe(365);
    expect(cadence.rate(longReview, 'good', now).intervalDays).toBe(365);
    expect(cadence.rate(longReview, 'easy', now).intervalDays).toBe(365);
  });

  it('rejects an invalid clock', () => {
    expect(() => cadence.rate(newState, 'good', new Date('invalid'))).toThrow('valid date');
  });
});
