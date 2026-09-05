import { describe, expect, it } from 'vitest';
import { Cadence } from './Cadence.ts';
import type { CadenceState } from './CadenceState.ts';

const now = new Date('2026-01-01T00:00:00.000Z');
const newState: CadenceState = {
  nextReviewAt: null,
  intervalDays: null,
  reviewCount: 0,
  lapseCount: 0,
};

const studiedState: CadenceState = {
  nextReviewAt: '2026-01-05T00:00:00.000Z',
  intervalDays: 10,
  reviewCount: 8,
  lapseCount: 2,
};

function expectedDue(milliseconds: number): string {
  return new Date(now.getTime() + milliseconds).toISOString();
}

describe('Cadence', () => {
  const cadence = new Cadence();

  it.each([
    ['new again', newState, 'again', 1, 1, 0, 1],
    ['new hard', newState, 'hard', 1, 10, 0, 1],
    ['new good', newState, 'good', 1, 1440, 0, 1],
    ['new easy', newState, 'easy', 7, 10080, 0, 1],
    ['studied again', studiedState, 'again', 5, 1, 3, 9],
    ['studied hard', studiedState, 'hard', 12, 17280, 2, 9],
    ['studied good', studiedState, 'good', 20, 28800, 2, 9],
    ['studied easy', studiedState, 'easy', 40, 57600, 2, 9],
  ] as const)('%s applies the exact transition', (_name, state, rating, interval, dueMinutes, lapses, reviews) => {
    const result = cadence.rate(state, rating, now);
    expect(result).toMatchObject({
      intervalDays: interval,
      lapseCount: lapses,
      reviewCount: reviews,
    });
    expect(result.nextReviewAt).toBe(expectedDue(dueMinutes * 60_000));
  });

  it('accumulates rating history in the stored interval', () => {
    let state: CadenceState = { ...studiedState, intervalDays: 1 };
    state = cadence.rate(state, 'hard', now);
    state = cadence.rate(state, 'hard', now);
    state = cadence.rate(state, 'hard', now);
    expect(state.intervalDays).toBeCloseTo(1.728);
  });

  it('uses the ordinary studied transition after an Again retry', () => {
    const afterAgain = cadence.rate(studiedState, 'again', now);
    const afterGood = cadence.rate(afterAgain, 'good', now);
    expect(afterAgain.intervalDays).toBe(5);
    expect(afterAgain.nextReviewAt).toBe(expectedDue(60_000));
    expect(afterGood.intervalDays).toBe(10);
    expect(afterGood.nextReviewAt).toBe(expectedDue(10 * 86_400_000));
  });

  it('does not mutate the input state', () => {
    const before = structuredClone(studiedState);
    const result = cadence.rate(studiedState, 'good', now);
    expect(studiedState).toEqual(before);
    expect(result).not.toBe(studiedState);
  });

  it('clamps lower bounds for lapse and studied multipliers', () => {
    const shortReview = { ...studiedState, intervalDays: 1 };
    expect(cadence.rate(shortReview, 'again', now).intervalDays).toBe(1);
    expect(cadence.rate(shortReview, 'hard', now).intervalDays).toBe(1.2);
    expect(cadence.rate(shortReview, 'easy', now).intervalDays).toBe(7);
  });

  it('clamps all intervals to the maximum', () => {
    const longReview = { ...studiedState, intervalDays: 364 };
    expect(cadence.rate(longReview, 'hard', now).intervalDays).toBe(365);
    expect(cadence.rate(longReview, 'good', now).intervalDays).toBe(365);
    expect(cadence.rate(longReview, 'easy', now).intervalDays).toBe(365);
  });

  it('rejects incomplete scheduling state', () => {
    const invalid = { ...newState, nextReviewAt: now.toISOString() };
    expect(() => cadence.rate(invalid, 'good', now)).toThrow('all null for new cards or all populated');
  });

  it('rejects an invalid clock', () => {
    expect(() => cadence.rate(newState, 'good', new Date('invalid'))).toThrow('valid date');
  });
});
