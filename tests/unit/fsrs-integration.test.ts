import { describe, it, expect } from 'vitest';
import {
  createNewCardState,
  reviewCard,
  isDue,
  isNew,
  ratingName,
  Rating,
} from '../../src/utils/fsrs';

describe('FSRS integration', () => {
  it('creates a new card state with sensible defaults', () => {
    const state = createNewCardState();
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.suspended).toBe(false);
    expect(isNew(state)).toBe(true);
  });

  it('new card is due immediately', () => {
    const state = createNewCardState();
    expect(isDue(state)).toBe(true);
  });

  it('reviewing a new card with Good advances it', () => {
    const state = createNewCardState();
    const now = new Date('2025-02-01T10:00:00Z');
    const updated = reviewCard(state, Rating.Good, now);
    expect(updated.reps).toBe(1);
    expect(isNew(updated)).toBe(false);
    expect(new Date(updated.due).getTime()).toBeGreaterThan(now.getTime());
  });

  it('Again produces shorter interval than Good', () => {
    const state = createNewCardState();
    const now = new Date('2025-02-01T10:00:00Z');
    const again = reviewCard(state, Rating.Again, now);
    const good = reviewCard(state, Rating.Good, now);
    expect(new Date(again.due).getTime()).toBeLessThanOrEqual(new Date(good.due).getTime());
  });

  it('preserves suspended flag across reviews', () => {
    let state = createNewCardState();
    state.suspended = true;
    const updated = reviewCard(state, Rating.Good);
    expect(updated.suspended).toBe(true);
  });

  it('ratingName returns correct strings', () => {
    expect(ratingName(Rating.Again)).toBe('Again');
    expect(ratingName(Rating.Hard)).toBe('Hard');
    expect(ratingName(Rating.Good)).toBe('Good');
    expect(ratingName(Rating.Easy)).toBe('Easy');
  });
});
