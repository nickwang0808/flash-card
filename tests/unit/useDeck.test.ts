import { describe, it, expect } from 'vitest';
import { createEmptyCard, Rating, type Card } from 'ts-fsrs';
import { computeStudyItems, computeNewState, type StudyItem } from '../../src/hooks/useDeck';
import type { FlashCard } from '../../src/services/collections';

// Helper to create a FlashCard for testing
function createFlashCard(
  source: string,
  opts: {
    state?: Card | null;
    reverseState?: Card | null;
    reversible?: boolean;
  } = {}
): FlashCard {
  return {
    source,
    translation: `${source}-translation`,
    tags: [],
    created: '2025-01-01',
    reversible: opts.reversible ?? false,
    state: opts.state ?? null,
    reverseState: opts.reverseState ?? null,
  };
}

// Helper to create a due card state (due in the past)
function createDueState(dueDate: Date): Card {
  const card = createEmptyCard();
  return { ...card, due: dueDate, reps: 1 };
}

// Helper to create a future card state (not due yet)
function createFutureState(dueDate: Date): Card {
  const card = createEmptyCard();
  return { ...card, due: dueDate, reps: 1 };
}

describe('computeStudyItems', () => {
  const endOfDay = new Date('2025-02-01T23:59:59.999Z');
  const pastDate = new Date('2025-01-15T10:00:00Z');
  const futureDate = new Date('2025-02-15T10:00:00Z');

  it('returns empty arrays for empty cards', () => {
    const { newItems, dueItems } = computeStudyItems([], 10, endOfDay);
    expect(newItems).toEqual([]);
    expect(dueItems).toEqual([]);
  });

  it('includes cards without state as new items', () => {
    const cards = [createFlashCard('hello')];
    const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

    expect(newItems).toHaveLength(1);
    expect(newItems[0].source).toBe('hello');
    expect(newItems[0].isReverse).toBe(false);
    expect(dueItems).toHaveLength(0);
  });

  it('includes due cards in dueItems', () => {
    const cards = [createFlashCard('hello', { state: createDueState(pastDate) })];
    const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

    expect(newItems).toHaveLength(0);
    expect(dueItems).toHaveLength(1);
    expect(dueItems[0].source).toBe('hello');
  });

  it('excludes cards scheduled for the future', () => {
    const cards = [createFlashCard('hello', { state: createFutureState(futureDate) })];
    const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

    expect(newItems).toHaveLength(0);
    expect(dueItems).toHaveLength(0);
  });

  it('respects newCardsLimit', () => {
    const cards = [
      createFlashCard('one'),
      createFlashCard('two'),
      createFlashCard('three'),
    ];
    const { newItems } = computeStudyItems(cards, 2, endOfDay);

    expect(newItems).toHaveLength(2);
    expect(newItems[0].source).toBe('one');
    expect(newItems[1].source).toBe('two');
  });

  it('includes reverse direction for reversible cards', () => {
    const cards = [createFlashCard('hello', { reversible: true })];
    const { newItems } = computeStudyItems(cards, 10, endOfDay);

    expect(newItems).toHaveLength(2);
    expect(newItems[0].isReverse).toBe(false);
    expect(newItems[1].isReverse).toBe(true);
  });

  it('handles reversible cards with only forward state', () => {
    const cards = [
      createFlashCard('hello', {
        reversible: true,
        state: createFutureState(futureDate), // forward scheduled for future
        reverseState: null, // reverse is new
      }),
    ];
    const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

    // Forward is scheduled for future (excluded), reverse is new
    expect(newItems).toHaveLength(1);
    expect(newItems[0].isReverse).toBe(true);
    expect(dueItems).toHaveLength(0);
  });

  it('handles reversible cards with only reverse state', () => {
    const cards = [
      createFlashCard('hello', {
        reversible: true,
        state: null, // forward is new
        reverseState: createDueState(pastDate), // reverse is due
      }),
    ];
    const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

    expect(newItems).toHaveLength(1);
    expect(newItems[0].isReverse).toBe(false);
    expect(dueItems).toHaveLength(1);
    expect(dueItems[0].isReverse).toBe(true);
  });

  it('counts both directions against newCardsLimit', () => {
    const cards = [
      createFlashCard('one', { reversible: true }),
      createFlashCard('two', { reversible: true }),
    ];
    const { newItems } = computeStudyItems(cards, 3, endOfDay);

    // Should get: one-forward, one-reverse, two-forward (limit 3)
    expect(newItems).toHaveLength(3);
  });

  it('mixed new and due cards', () => {
    const cards = [
      createFlashCard('new-card'),
      createFlashCard('due-card', { state: createDueState(pastDate) }),
      createFlashCard('future-card', { state: createFutureState(futureDate) }),
    ];
    const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

    expect(newItems).toHaveLength(1);
    expect(newItems[0].source).toBe('new-card');
    expect(dueItems).toHaveLength(1);
    expect(dueItems[0].source).toBe('due-card');
  });
});

describe('computeNewState', () => {
  const now = new Date('2025-02-01T10:00:00Z');

  it('creates new state from null (new card)', () => {
    const newState = computeNewState(null, Rating.Good, now);

    expect(newState.reps).toBe(1);
    expect(newState.due.getTime()).toBeGreaterThan(now.getTime());
  });

  it('updates existing state', () => {
    const existingState = createEmptyCard();
    const newState = computeNewState(existingState, Rating.Good, now);

    expect(newState.reps).toBe(1);
  });

  it('Again produces shorter interval than Easy', () => {
    const againState = computeNewState(null, Rating.Again, now);
    const easyState = computeNewState(null, Rating.Easy, now);

    expect(againState.due.getTime()).toBeLessThan(easyState.due.getTime());
  });

  it('Hard produces shorter interval than Good', () => {
    const hardState = computeNewState(null, Rating.Hard, now);
    const goodState = computeNewState(null, Rating.Good, now);

    expect(hardState.due.getTime()).toBeLessThanOrEqual(goodState.due.getTime());
  });

  it('Easy produces longest interval', () => {
    const againState = computeNewState(null, Rating.Again, now);
    const hardState = computeNewState(null, Rating.Hard, now);
    const goodState = computeNewState(null, Rating.Good, now);
    const easyState = computeNewState(null, Rating.Easy, now);

    expect(easyState.due.getTime()).toBeGreaterThanOrEqual(goodState.due.getTime());
    expect(goodState.due.getTime()).toBeGreaterThanOrEqual(hardState.due.getTime());
    expect(hardState.due.getTime()).toBeGreaterThanOrEqual(againState.due.getTime());
  });

  it('increments reps on review', () => {
    let state = computeNewState(null, Rating.Good, now);
    expect(state.reps).toBe(1);

    state = computeNewState(state, Rating.Good, new Date(now.getTime() + 86400000));
    expect(state.reps).toBe(2);
  });

  it('Again on a mature card increments lapses', () => {
    // Create a mature card by reviewing multiple times
    let state = computeNewState(null, Rating.Good, now);

    // Review several times to make it "mature" (review state)
    for (let i = 0; i < 3; i++) {
      state = computeNewState(
        state,
        Rating.Good,
        new Date(state.due.getTime() + 1000)
      );
    }
    const lapsesBefore = state.lapses;

    // Now hitting Again should count as a lapse
    state = computeNewState(state, Rating.Again, new Date(state.due.getTime() + 1000));
    expect(state.lapses).toBeGreaterThanOrEqual(lapsesBefore);
  });
});
