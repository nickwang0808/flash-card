import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createEmptyCard, Rating, type Card, type Grade } from 'ts-fsrs';
import {
  computeStudyItems,
  computeNewState,
  rateCard,
  useDeck,
  type StudyItem,
} from '../../src/hooks/useDeck';
import type { FlashCard } from '../../src/services/card-repository';

// ============================================================================
// Test Helpers
// ============================================================================

function createFlashCard(
  term: string,
  opts: {
    back?: string;
    front?: string;
    state?: Card | null;
    reverseState?: Card | null;
    reversible?: boolean;
    deckName?: string;
  } = {}
): FlashCard {
  const deckName = opts.deckName ?? 'test-deck';
  return {
    id: `${deckName}|${term}`,
    deckName,
    term,
    front: opts.front,
    back: opts.back ?? `${term}-translation`,
    tags: [],
    created: '2025-01-01',
    reversible: opts.reversible ?? false,
    state: opts.state ?? null,
    reverseState: opts.reverseState ?? null,
  };
}

function createDueState(dueDate: Date): Card {
  const card = createEmptyCard();
  return { ...card, due: dueDate, reps: 1 };
}

function createFutureState(daysFromNow: number): Card {
  const card = createEmptyCard();
  const future = new Date();
  future.setDate(future.getDate() + daysFromNow);
  return { ...card, due: future, reps: 1 };
}

function createPastState(daysAgo: number): Card {
  const card = createEmptyCard();
  const past = new Date();
  past.setDate(past.getDate() - daysAgo);
  return { ...card, due: past, reps: 1 };
}

// ============================================================================
// Pure Function Tests: computeStudyItems
// ============================================================================

describe('computeStudyItems', () => {
  // Compute endOfDay fresh for each test to avoid midnight boundary issues
  function getEndOfDay(): Date {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
  }

  describe('basic filtering', () => {
    const endOfDay = getEndOfDay();
    it('returns empty arrays for empty cards', () => {
      const { newItems, dueItems } = computeStudyItems([], 10, endOfDay);
      expect(newItems).toEqual([]);
      expect(dueItems).toEqual([]);
    });

    it('includes cards without state as new items', () => {
      const cards = [createFlashCard('hello')];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].term).toBe('hello');
      expect(newItems[0].isReverse).toBe(false);
      expect(dueItems).toHaveLength(0);
    });

    it('includes due cards (past due date) in dueItems', () => {
      const cards = [createFlashCard('hello', { state: createPastState(1) })];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(1);
      expect(dueItems[0].term).toBe('hello');
    });

    it('includes cards due today in dueItems', () => {
      const todayDue = new Date();
      todayDue.setHours(12, 0, 0, 0); // noon today
      const cards = [createFlashCard('hello', { state: createDueState(todayDue) })];
      const { dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(dueItems).toHaveLength(1);
    });

    it('excludes cards scheduled for the future', () => {
      const cards = [createFlashCard('hello', { state: createFutureState(5) })];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(0);
    });
  });

  describe('newCardsLimit', () => {
    const endOfDay = getEndOfDay();

    it('respects newCardsLimit for new cards', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
        createFlashCard('four'),
      ];
      const { newItems } = computeStudyItems(cards, 2, endOfDay);

      expect(newItems).toHaveLength(2);
      expect(newItems[0].term).toBe('one');
      expect(newItems[1].term).toBe('two');
    });

    it('does not limit due cards', () => {
      const cards = [
        createFlashCard('one', { state: createPastState(1) }),
        createFlashCard('two', { state: createPastState(1) }),
        createFlashCard('three', { state: createPastState(1) }),
      ];
      const { dueItems } = computeStudyItems(cards, 1, endOfDay);

      expect(dueItems).toHaveLength(3);
    });

    it('limit of 0 means no new cards', () => {
      const cards = [createFlashCard('one'), createFlashCard('two')];
      const { newItems } = computeStudyItems(cards, 0, endOfDay);

      expect(newItems).toHaveLength(0);
    });
  });

  describe('reversible cards', () => {
    const endOfDay = getEndOfDay();

    it('includes both directions for reversible cards', () => {
      const cards = [createFlashCard('hello', { reversible: true })];
      const { newItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(2);
      expect(newItems[0].isReverse).toBe(false);
      expect(newItems[1].isReverse).toBe(true);
    });

    it('counts both directions against newCardsLimit', () => {
      const cards = [
        createFlashCard('one', { reversible: true }),
        createFlashCard('two', { reversible: true }),
      ];
      const { newItems } = computeStudyItems(cards, 3, endOfDay);

      // one reserves 2 slots (fwd+rev), two gets only forward (1 slot left)
      expect(newItems).toHaveLength(3);
      expect(newItems.map((i) => `${i.term}-${i.isReverse}`)).toEqual([
        'one-false',
        'two-false',
        'one-true',
      ]);
    });

    it('reserves slots for reverse when reversible card appears before limit', () => {
      const cards = [
        createFlashCard('rev', { reversible: true }),
        createFlashCard('non-rev-1'),
        createFlashCard('non-rev-2'),
      ];
      const { newItems } = computeStudyItems(cards, 3, endOfDay);

      // rev takes 2 slots (fwd+rev), non-rev-1 takes 1 slot, non-rev-2 excluded
      expect(newItems).toHaveLength(3);
      expect(newItems.map((i) => `${i.term}-${i.isReverse}`)).toEqual([
        'rev-false',
        'non-rev-1-false',
        'rev-true',
      ]);
    });

    it('only adds forward when just one slot remains for reversible card', () => {
      const cards = [
        createFlashCard('non-rev-1'),
        createFlashCard('non-rev-2'),
        createFlashCard('rev', { reversible: true }),
      ];
      const { newItems } = computeStudyItems(cards, 3, endOfDay);

      // non-rev-1 and non-rev-2 take 2 slots, rev gets only forward (1 slot left)
      expect(newItems).toHaveLength(3);
      expect(newItems.map((i) => `${i.term}-${i.isReverse}`)).toEqual([
        'non-rev-1-false',
        'non-rev-2-false',
        'rev-false',
      ]);
    });

    it('mixed reversible and non-reversible cards with tight limit', () => {
      const cards = [
        createFlashCard('a'),
        createFlashCard('b', { reversible: true }),
        createFlashCard('c'),
        createFlashCard('d', { reversible: true }),
        createFlashCard('e'),
      ];
      const { newItems } = computeStudyItems(cards, 5, endOfDay);

      // a(1), b-fwd+b-rev(3), c(4), d needs 2 but only 1 left → d-fwd(5)
      expect(newItems).toHaveLength(5);
      expect(newItems.map((i) => `${i.term}-${i.isReverse}`)).toEqual([
        'a-false',
        'b-false',
        'c-false',
        'd-false',
        'b-true',
      ]);
    });

    it('all reversible cards with limit produces equal forward and reverse items', () => {
      const cards = Array.from({ length: 30 }, (_, i) =>
        createFlashCard(`card-${i}`, { reversible: true })
      );
      const { newItems } = computeStudyItems(cards, 10, endOfDay);

      // 10 slots → 5 cards × 2 directions = 10 items
      expect(newItems).toHaveLength(10);
      const forward = newItems.filter((i) => !i.isReverse);
      const reverse = newItems.filter((i) => i.isReverse);
      expect(forward).toHaveLength(5);
      expect(reverse).toHaveLength(5);
      // Same 5 cards appear in both directions
      expect(forward.map((i) => i.term)).toEqual(reverse.map((i) => i.term));
    });

    it('handles forward reviewed but reverse new', () => {
      const cards = [
        createFlashCard('hello', {
          reversible: true,
          state: createFutureState(5), // forward scheduled for future
          reverseState: null, // reverse is new
        }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].isReverse).toBe(true);
      expect(dueItems).toHaveLength(0);
    });

    it('handles forward new but reverse due', () => {
      const cards = [
        createFlashCard('hello', {
          reversible: true,
          state: null, // forward is new
          reverseState: createPastState(1), // reverse is due
        }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].isReverse).toBe(false);
      expect(dueItems).toHaveLength(1);
      expect(dueItems[0].isReverse).toBe(true);
    });

    it('handles both directions due', () => {
      const cards = [
        createFlashCard('hello', {
          reversible: true,
          state: createPastState(1),
          reverseState: createPastState(2),
        }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(2);
    });

    it('handles both directions scheduled for future', () => {
      const cards = [
        createFlashCard('hello', {
          reversible: true,
          state: createFutureState(3),
          reverseState: createFutureState(5),
        }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(0);
    });
  });

  describe('mixed scenarios', () => {
    const endOfDay = getEndOfDay();

    it('separates new and due cards correctly', () => {
      const cards = [
        createFlashCard('new-card'),
        createFlashCard('due-card', { state: createPastState(1) }),
        createFlashCard('future-card', { state: createFutureState(5) }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].term).toBe('new-card');
      expect(dueItems).toHaveLength(1);
      expect(dueItems[0].term).toBe('due-card');
    });

    it('processes cards in order', () => {
      const cards = [
        createFlashCard('a'),
        createFlashCard('b'),
        createFlashCard('c'),
      ];
      const { newItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems.map((i) => i.term)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('introducedToday tracking', () => {
    const endOfDay = getEndOfDay();

    it('counts already-introduced cards toward limit', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
        createFlashCard('four'),
      ];
      // Simulate 2 cards already introduced today
      const introducedToday = new Set(['one', 'two']);

      const { newItems } = computeStudyItems(cards, 3, endOfDay, introducedToday);

      // Limit is 3, 2 already introduced, so only 1 new slot remains
      // Should include: one (introduced), two (introduced), three (new slot)
      expect(newItems).toHaveLength(3);
      expect(newItems.map((i) => i.term)).toEqual(['one', 'two', 'three']);
    });

    it('includes already-introduced cards even if over limit', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
      ];
      // 3 cards already introduced, but limit is 2
      const introducedToday = new Set(['one', 'two', 'three']);

      const { newItems } = computeStudyItems(cards, 2, endOfDay, introducedToday);

      // All 3 should be included because they were already introduced
      expect(newItems).toHaveLength(3);
    });

    it('does not include new cards when limit reached by introduced cards', () => {
      const cards = [
        createFlashCard('introduced-a'),
        createFlashCard('introduced-b'),
        createFlashCard('not-introduced'),
      ];
      const introducedToday = new Set(['introduced-a', 'introduced-b']);

      const { newItems } = computeStudyItems(cards, 2, endOfDay, introducedToday);

      // Limit is 2, both slots filled by introduced cards
      expect(newItems).toHaveLength(2);
      expect(newItems.map((i) => i.term)).toEqual(['introduced-a', 'introduced-b']);
    });

    it('tracks reverse cards separately with :reverse suffix', () => {
      const cards = [
        createFlashCard('hello', { reversible: true }),
      ];
      // Only the reverse was introduced
      const introducedToday = new Set(['hello:reverse']);

      const { newItems } = computeStudyItems(cards, 1, endOfDay, introducedToday);

      // Limit is 1, reverse is introduced (counts toward limit)
      // Forward: not introduced, 0 < 0 = false, not included
      // Reverse: is introduced, included
      expect(newItems).toHaveLength(1);
      expect(newItems[0].isReverse).toBe(true);
    });

    it('handles empty introducedToday set', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
      ];
      const introducedToday = new Set<string>();

      const { newItems } = computeStudyItems(cards, 10, endOfDay, introducedToday);

      expect(newItems).toHaveLength(2);
    });

    it('works with default empty set when not provided', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
      ];

      // Call without introducedToday parameter
      const { newItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('card due at exact end of day boundary is included', () => {
      const endOfDay = getEndOfDay();
      const cardDueAtBoundary = createFlashCard('boundary', {
        state: createDueState(endOfDay), // exactly at 23:59:59.999
      });
      const { dueItems } = computeStudyItems([cardDueAtBoundary], 10, endOfDay);

      expect(dueItems).toHaveLength(1);
    });

    it('card due 1ms after end of day is excluded', () => {
      const endOfDay = getEndOfDay();
      const tomorrow = new Date(endOfDay.getTime() + 1);
      const cardDueTomorrow = createFlashCard('tomorrow', {
        state: createDueState(tomorrow),
      });
      const { dueItems } = computeStudyItems([cardDueTomorrow], 10, endOfDay);

      expect(dueItems).toHaveLength(0);
    });

    it('non-reversible card ignores reverseState', () => {
      const endOfDay = getEndOfDay();
      // Card marked as non-reversible but has reverseState (data inconsistency)
      const card = createFlashCard('inconsistent', {
        reversible: false,
        state: null, // forward is new
        reverseState: createPastState(1), // should be ignored
      });
      const { newItems, dueItems } = computeStudyItems([card], 10, endOfDay);

      // Only forward direction should appear
      expect(newItems).toHaveLength(1);
      expect(newItems[0].isReverse).toBe(false);
      expect(dueItems).toHaveLength(0); // reverse ignored
    });

    it('handles empty back', () => {
      const endOfDay = getEndOfDay();
      const card = createFlashCard('test', { back: '' });
      const { newItems } = computeStudyItems([card], 10, endOfDay);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].back).toBe('');
    });

    it('handles very large newCardsLimit', () => {
      const endOfDay = getEndOfDay();
      const cards = [createFlashCard('one'), createFlashCard('two')];
      const { newItems } = computeStudyItems(cards, Number.MAX_SAFE_INTEGER, endOfDay);

      expect(newItems).toHaveLength(2);
    });
  });

  describe('learning card ordering', () => {
    it('sorts learning cards after overdue review cards in dueItems', () => {
      const endOfDay = getEndOfDay();

      // Simulate: card1 was just rated "Again" (Learning state, due in 1 min)
      const { card: learningState } = computeNewState(null, Rating.Again);

      // card2 is an overdue review card (due yesterday)
      const cards = [
        createFlashCard('just-rated-again', { state: learningState }),
        createFlashCard('overdue-review', { state: createPastState(1) }),
      ];

      const { dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(dueItems).toHaveLength(2);
      // Overdue review card should come first, not the just-rated learning card
      expect(dueItems[0].term).toBe('overdue-review');
      expect(dueItems[1].term).toBe('just-rated-again');
    });

    it('sorts multiple learning cards by due time (oldest due first)', () => {
      const endOfDay = getEndOfDay();

      // card1 rated "Again" 5 minutes ago (due 4 min ago)
      const pastTime = new Date(Date.now() - 5 * 60 * 1000);
      const { card: olderLearning } = computeNewState(null, Rating.Again, pastTime);

      // card2 rated "Again" just now (due in 1 min)
      const { card: newerLearning } = computeNewState(null, Rating.Again);

      const cards = [
        createFlashCard('newer-again', { state: newerLearning }),
        createFlashCard('older-again', { state: olderLearning }),
      ];

      const { dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(dueItems).toHaveLength(2);
      // Older learning card (due earlier) should come first
      expect(dueItems[0].term).toBe('older-again');
      expect(dueItems[1].term).toBe('newer-again');
    });
  });
});

// ============================================================================
// Pure Function Tests: computeNewState
// ============================================================================

describe('computeNewState', () => {
  const now = new Date('2025-02-01T10:00:00Z');

  describe('new card (null state)', () => {
    it('creates state from null', () => {
      const { card: newState } = computeNewState(null, Rating.Good, now);

      expect(newState.reps).toBe(1);
      expect(newState.due.getTime()).toBeGreaterThan(now.getTime());
    });

    it('all ratings create valid state', () => {
      const ratings: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

      for (const rating of ratings) {
        const { card: state } = computeNewState(null, rating, now);
        expect(state.reps).toBeGreaterThanOrEqual(0);
        expect(state.due).toBeInstanceOf(Date);
      }
    });
  });

  describe('rating intervals', () => {
    it('Again produces shortest interval', () => {
      const { card: again } = computeNewState(null, Rating.Again, now);
      const { card: hard } = computeNewState(null, Rating.Hard, now);
      const { card: good } = computeNewState(null, Rating.Good, now);
      const { card: easy } = computeNewState(null, Rating.Easy, now);

      expect(again.due.getTime()).toBeLessThanOrEqual(hard.due.getTime());
      expect(hard.due.getTime()).toBeLessThanOrEqual(good.due.getTime());
      expect(good.due.getTime()).toBeLessThanOrEqual(easy.due.getTime());
    });

    it('Easy produces longest interval', () => {
      const { card: again } = computeNewState(null, Rating.Again, now);
      const { card: easy } = computeNewState(null, Rating.Easy, now);

      expect(easy.due.getTime()).toBeGreaterThan(again.due.getTime());
    });

    it('Again on new card is due very soon (within minutes)', () => {
      const { card: state } = computeNewState(null, Rating.Again, now);
      const diffMinutes = (state.due.getTime() - now.getTime()) / (1000 * 60);

      expect(diffMinutes).toBeLessThan(60); // Within an hour
    });

    it('Easy on new card is due in days', () => {
      const { card: state } = computeNewState(null, Rating.Easy, now);
      const diffDays = (state.due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeGreaterThan(1);
    });
  });

  describe('updating existing state', () => {
    it('increments reps on each review', () => {
      let { card: state } = computeNewState(null, Rating.Good, now);
      expect(state.reps).toBe(1);

      ({ card: state } = computeNewState(state, Rating.Good, new Date(state.due.getTime() + 1000)));
      expect(state.reps).toBe(2);

      ({ card: state } = computeNewState(state, Rating.Good, new Date(state.due.getTime() + 1000)));
      expect(state.reps).toBe(3);
    });

    it('maintains learning progress with Good ratings', () => {
      let { card: state } = computeNewState(null, Rating.Good, now);
      const intervals: number[] = [];

      for (let i = 0; i < 5; i++) {
        const nextReview = new Date(state.due.getTime() + 1000);
        const prevDue = state.due;
        ({ card: state } = computeNewState(state, Rating.Good, nextReview));
        intervals.push(state.due.getTime() - prevDue.getTime());
      }

      // Intervals should generally increase (spaced repetition)
      // Not strictly increasing due to FSRS algorithm nuances
      expect(intervals[intervals.length - 1]).toBeGreaterThan(intervals[0]);
    });
  });

  describe('state validity', () => {
    it('returns valid Card object with all required fields', () => {
      const { card: state } = computeNewState(null, Rating.Good, now);

      // Verify all FSRS Card fields are present and valid
      expect(state.due).toBeInstanceOf(Date);
      expect(typeof state.stability).toBe('number');
      expect(typeof state.difficulty).toBe('number');
      expect(typeof state.elapsed_days).toBe('number');
      expect(typeof state.scheduled_days).toBe('number');
      expect(typeof state.reps).toBe('number');
      expect(typeof state.lapses).toBe('number');
      expect(typeof state.state).toBe('number'); // FSRS state enum
    });

    it('due date is always a valid Date object', () => {
      const ratings: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

      for (const rating of ratings) {
        const { card: state } = computeNewState(null, rating, now);
        expect(state.due).toBeInstanceOf(Date);
        expect(isNaN(state.due.getTime())).toBe(false);
      }
    });
  });

  describe('Hard and Good behavior on new cards', () => {
    it('Good on new card may still be due today (learning phase)', () => {
      const { card: state } = computeNewState(null, Rating.Good, now);
      // FSRS Good on new card typically schedules for ~10 minutes, still within today
      // This is the expected behavior - card stays in session for learning
      expect(state.reps).toBe(1);
    });

    it('Hard on new card schedules for very short interval', () => {
      const { card: state } = computeNewState(null, Rating.Hard, now);
      const diffMinutes = (state.due.getTime() - now.getTime()) / (1000 * 60);

      // Hard should schedule for a short interval (typically ~5 minutes)
      expect(diffMinutes).toBeLessThan(60);
    });
  });
});

// ============================================================================
// rateCard Function Tests
// ============================================================================

describe('rateCard', () => {
  it('updates forward state via repository for non-reverse card', async () => {
    const mockUpdateState = vi.fn(() => Promise.resolve());
    const mockInsert = vi.fn(() => Promise.resolve());
    const { getCardRepository } = await import('../../src/services/card-repository');
    const { getReviewLogRepository } = await import('../../src/services/review-log-repository');
    vi.mocked(getCardRepository).mockReturnValue({
      updateState: mockUpdateState,
    } as any);
    vi.mocked(getReviewLogRepository).mockReturnValue({
      insert: mockInsert,
    } as any);

    const card: StudyItem = {
      ...createFlashCard('hello'),
      isReverse: false,
    };

    await rateCard(card, Rating.Good);

    expect(mockUpdateState).toHaveBeenCalledWith('test-deck|hello', 'state', expect.any(Object));
  });

  it('updates reverse state via repository for reverse card', async () => {
    const mockUpdateState = vi.fn(() => Promise.resolve());
    const mockInsert = vi.fn(() => Promise.resolve());
    const { getCardRepository } = await import('../../src/services/card-repository');
    const { getReviewLogRepository } = await import('../../src/services/review-log-repository');
    vi.mocked(getCardRepository).mockReturnValue({
      updateState: mockUpdateState,
    } as any);
    vi.mocked(getReviewLogRepository).mockReturnValue({
      insert: mockInsert,
    } as any);

    const card: StudyItem = {
      ...createFlashCard('hello', { reversible: true }),
      isReverse: true,
    };

    await rateCard(card, Rating.Good);

    expect(mockUpdateState).toHaveBeenCalledWith('test-deck|hello', 'reverseState', expect.any(Object));
  });

  it('inserts a review log via repository when rating', async () => {
    const mockUpdateState = vi.fn(() => Promise.resolve());
    const mockInsert = vi.fn(() => Promise.resolve());
    const { getCardRepository } = await import('../../src/services/card-repository');
    const { getReviewLogRepository } = await import('../../src/services/review-log-repository');
    vi.mocked(getCardRepository).mockReturnValue({
      updateState: mockUpdateState,
    } as any);
    vi.mocked(getReviewLogRepository).mockReturnValue({
      insert: mockInsert,
    } as any);

    const card: StudyItem = {
      ...createFlashCard('hello'),
      isReverse: false,
    };

    await rateCard(card, Rating.Good);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedLog = (mockInsert.mock.calls as any[][])[0][0];
    expect(insertedLog.cardId).toBe('test-deck|hello');
    expect(insertedLog.isReverse).toBe(false);
    expect(insertedLog.rating).toBe(Rating.Good);
  });
});

// ============================================================================
// useDeck Hook Integration Tests
// ============================================================================

// Mock modules
vi.mock('../../src/services/card-repository', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getCardRepository: vi.fn(() => ({
      updateState: vi.fn(() => Promise.resolve()),
      suspend: vi.fn(() => Promise.resolve()),
    })),
    useCards: vi.fn(() => ({ data: [], isLoading: false })),
    useDeckNames: vi.fn(() => ({ data: [], isLoading: false })),
  };
});

vi.mock('../../src/services/review-log-repository', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getReviewLogRepository: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    })),
    useReviewLogs: vi.fn(() => ({ data: [], isLoading: false })),
  };
});

vi.mock('../../src/services/replication', () => ({
  notifyChange: vi.fn(),
  cancelSync: vi.fn(),
}));

vi.mock('../../src/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '../../src/hooks/useSettings';
import { useCards, getCardRepository } from '../../src/services/card-repository';
import { useReviewLogs, getReviewLogRepository } from '../../src/services/review-log-repository';

describe('useDeck hook', () => {
  let mockCards: FlashCard[];

  function setupMock(cards: FlashCard[], logs: any[] = [], isLoading = false) {
    vi.mocked(useCards).mockReturnValue({ data: cards, isLoading });
    vi.mocked(useReviewLogs).mockReturnValue({ data: logs, isLoading });
  }

  beforeEach(() => {
    mockCards = [];

    vi.mocked(getCardRepository).mockReturnValue({
      updateState: vi.fn(() => Promise.resolve()),
      suspend: vi.fn(() => Promise.resolve()),
    } as any);
    vi.mocked(getReviewLogRepository).mockReturnValue({
      insert: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    } as any);
    vi.mocked(useSettings).mockReturnValue({
      settings: { newCardsPerDay: 10 },
      isLoading: false,
      update: vi.fn(),
      clear: vi.fn(),
    } as any);
    setupMock(mockCards);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('returns isLoading true when query is loading', () => {
      setupMock([], [], true);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.isLoading).toBe(true);
      expect(result.current.currentCard).toBeNull();
      expect(result.current.remaining).toBe(0);
    });

    it('returns isLoading false when data is loaded', () => {
      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('empty deck', () => {
    it('returns null currentCard for empty deck', () => {
      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard).toBeNull();
      expect(result.current.remaining).toBe(0);
    });
  });

  describe('card ordering', () => {
    it('shows new cards before due cards', () => {
      mockCards = [
        createFlashCard('due-card', { state: createPastState(1) }),
        createFlashCard('new-card'),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.term).toBe('new-card');
      expect(result.current.newItems).toHaveLength(1);
      expect(result.current.dueItems).toHaveLength(1);
    });

    it('maintains card order within categories', () => {
      mockCards = [
        createFlashCard('new-a'),
        createFlashCard('new-b'),
        createFlashCard('new-c'),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.newItems.map((i) => i.term)).toEqual([
        'new-a',
        'new-b',
        'new-c',
      ]);
    });
  });

  describe('currentCard display data', () => {
    it('sets front/back correctly for forward direction', () => {
      mockCards = [createFlashCard('hola', { back: 'hello' })];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard).toEqual({
        term: 'hola',
        front: 'hola',    // defaults to term when no custom front
        back: 'hello',
        isReverse: false,
        isNew: true,
      });
    });

    it('uses custom front when provided', () => {
      mockCards = [createFlashCard('hola', { front: '# Hola', back: 'hello' })];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.front).toBe('# Hola');
    });

    it('sets front/back correctly for reverse direction', () => {
      mockCards = [
        createFlashCard('hola', {
          back: 'hello',
          reversible: true,
          state: createFutureState(5), // forward scheduled
          reverseState: null, // reverse is new
        }),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard).toEqual({
        term: 'hola',
        front: 'hello', // back shown as front in reverse
        back: 'hola',   // term (default front) shown as back in reverse
        isReverse: true,
        isNew: true,
      });
    });

    it('marks new cards as isNew true', () => {
      mockCards = [createFlashCard('new-card')];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isNew).toBe(true);
    });

    it('marks reviewed cards as isNew false', () => {
      mockCards = [createFlashCard('reviewed', { state: createPastState(1) })];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isNew).toBe(false);
    });

    it('marks reviewed reverse card as isNew false', () => {
      // Card where reverse direction was previously reviewed and is now due again
      mockCards = [
        createFlashCard('reviewed-reverse', {
          reversible: true,
          state: createFutureState(5), // forward scheduled for future
          reverseState: createPastState(1), // reverse was reviewed and is due
        }),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isReverse).toBe(true);
      expect(result.current.currentCard?.isNew).toBe(false); // Not new - was previously reviewed
    });

    it('marks new reverse card as isNew true', () => {
      mockCards = [
        createFlashCard('new-reverse', {
          reversible: true,
          state: createFutureState(5), // forward scheduled
          reverseState: null, // reverse never reviewed
        }),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isReverse).toBe(true);
      expect(result.current.currentCard?.isNew).toBe(true);
    });
  });

  describe('remaining count', () => {
    it('counts all study items', () => {
      mockCards = [
        createFlashCard('new-1'),
        createFlashCard('new-2'),
        createFlashCard('due-1', { state: createPastState(1) }),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.remaining).toBe(3);
    });

    it('counts both directions of reversible cards', () => {
      mockCards = [createFlashCard('reversible', { reversible: true })];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.remaining).toBe(2);
    });

    it('respects newCardsLimit in count', () => {
      vi.mocked(useSettings).mockReturnValue({
        settings: { newCardsPerDay: 2 },
        isLoading: false,
        update: vi.fn(),
        clear: vi.fn(),
      } as any);

      mockCards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
        createFlashCard('four'),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.remaining).toBe(2);
    });
  });

  describe('rate function', () => {
    it('calls repository updateState with correct card ID when rating', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      const mockInsert = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: mockInsert,
        remove: vi.fn(() => Promise.resolve()),
      } as any);

      mockCards = [createFlashCard('test-card')];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      // Allow async rateCard to complete
      await vi.waitFor(() => {
        expect(mockUpdateState).toHaveBeenCalledWith('test-deck|test-card', 'state', expect.any(Object));
      });
    });

    it('does nothing when no current card', () => {
      const mockUpdateState = vi.fn();
      const mockInsert = vi.fn();
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: mockInsert,
        remove: vi.fn(() => Promise.resolve()),
      } as any);

      setupMock([]);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      expect(mockUpdateState).not.toHaveBeenCalled();
    });

    it('patches forward state for non-reverse card', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      const mockInsert = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: mockInsert,
        remove: vi.fn(() => Promise.resolve()),
      } as any);

      mockCards = [createFlashCard('test-card')];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      await vi.waitFor(() => {
        expect(mockUpdateState).toHaveBeenCalledWith('test-deck|test-card', 'state', expect.any(Object));
      });
    });

    it('patches reverse state for reverse card', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      const mockInsert = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: mockInsert,
        remove: vi.fn(() => Promise.resolve()),
      } as any);

      mockCards = [
        createFlashCard('test-card', {
          reversible: true,
          state: createFutureState(5),
          reverseState: null,
        }),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isReverse).toBe(true);

      act(() => {
        result.current.rate(Rating.Good);
      });

      await vi.waitFor(() => {
        expect(mockUpdateState).toHaveBeenCalledWith('test-deck|test-card', 'reverseState', expect.any(Object));
      });
    });
  });

  describe('newCardsPerDay setting', () => {
    it('uses setting from useSettings', () => {
      vi.mocked(useSettings).mockReturnValue({
        settings: { newCardsPerDay: 3 },
        isLoading: false,
        update: vi.fn(),
        clear: vi.fn(),
      } as any);

      mockCards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
        createFlashCard('four'),
        createFlashCard('five'),
      ];
      setupMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.newItems).toHaveLength(3);
      expect(result.current.remaining).toBe(3);
    });
  });

  describe('deck name handling', () => {
    it('calls useCards with deckName', () => {
      renderHook(() => useDeck('my-spanish-deck'));

      expect(useCards).toHaveBeenCalledWith('my-spanish-deck');
    });
  });
});

// ============================================================================
// Study Session Flow Tests (Integration-style)
// ============================================================================

describe('Study Session Flow', () => {
  function setupMock(cards: FlashCard[], logs: any[] = [], isLoading = false) {
    vi.mocked(useCards).mockReturnValue({ data: cards, isLoading });
    vi.mocked(useReviewLogs).mockReturnValue({ data: logs, isLoading });
  }

  beforeEach(() => {
    vi.mocked(getCardRepository).mockReturnValue({
      updateState: vi.fn(() => Promise.resolve()),
      suspend: vi.fn(() => Promise.resolve()),
    } as any);
    vi.mocked(getReviewLogRepository).mockReturnValue({
      insert: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    } as any);
    vi.mocked(useSettings).mockReturnValue({
      settings: { newCardsPerDay: 10 },
      isLoading: false,
      update: vi.fn(),
      clear: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('simulates complete session: new cards → rating → completion', () => {
    // Start with 2 new cards
    let cards = [createFlashCard('card-a'), createFlashCard('card-b')];
    setupMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(2);
    expect(result.current.currentCard?.term).toBe('card-a');
    expect(result.current.currentCard?.isNew).toBe(true);

    // Simulate rating card-a as Easy
    const { card: state1 } = computeNewState(null, Rating.Easy);

    cards = [
      { ...createFlashCard('card-a'), state: state1 },
      createFlashCard('card-b'),
    ];
    setupMock(cards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.term).toBe('card-b');

    // Simulate rating card-b as Easy
    const { card: state2 } = computeNewState(null, Rating.Easy);

    cards = [
      { ...createFlashCard('card-a'), state: state1 },
      { ...createFlashCard('card-b'), state: state2 },
    ];
    setupMock(cards);
    rerender();

    expect(result.current.remaining).toBe(0);
    expect(result.current.currentCard).toBeNull();
  });

  it('Again keeps card in session (due immediately)', () => {
    const cards = [createFlashCard('test-card')];
    setupMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));
    expect(result.current.remaining).toBe(1);

    // Simulate rating Again
    const { card: newState } = computeNewState(null, Rating.Again);

    const updatedCards = [{ ...createFlashCard('test-card'), state: newState }];
    setupMock(updatedCards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.term).toBe('test-card');
    expect(result.current.currentCard?.isNew).toBe(false);
  });

  it('Easy removes card from session (scheduled for future)', () => {
    const cards = [createFlashCard('test-card')];
    setupMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));
    expect(result.current.remaining).toBe(1);

    // Simulate rating Easy
    const { card: newState } = computeNewState(null, Rating.Easy);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    expect(newState.due.getTime()).toBeGreaterThan(endOfToday.getTime());

    const updatedCards = [{ ...createFlashCard('test-card'), state: newState }];
    setupMock(updatedCards);
    rerender();

    expect(result.current.remaining).toBe(0);
    expect(result.current.currentCard).toBeNull();
  });

  it('handles reversible card session with both directions', () => {
    const cards = [createFlashCard('gato', { back: 'cat', reversible: true })];
    setupMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(2);
    expect(result.current.currentCard?.front).toBe('gato');
    expect(result.current.currentCard?.isReverse).toBe(false);

    // Simulate forward rated as Easy (scheduled for future)
    const { card: forwardState } = computeNewState(null, Rating.Easy);

    const updatedCards = [
      {
        ...createFlashCard('gato', { back: 'cat', reversible: true }),
        state: forwardState,
        reverseState: null,
      },
    ];
    setupMock(updatedCards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.front).toBe('cat');
    expect(result.current.currentCard?.back).toBe('gato');
    expect(result.current.currentCard?.isReverse).toBe(true);
  });

  it('Good on new card keeps it in session (learning phase)', () => {
    const cards = [createFlashCard('test-card')];
    setupMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.isNew).toBe(true);

    // Simulate rating Good
    const { card: newState } = computeNewState(null, Rating.Good);

    const updatedCards = [{ ...createFlashCard('test-card'), state: newState }];
    setupMock(updatedCards);
    rerender();

    expect(result.current.currentCard?.isNew).toBe(false);
  });

  it('multiple ratings update state correctly', () => {
    let cards = [createFlashCard('test-card')];
    setupMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    // First rating: Again
    const { card: state1 } = computeNewState(null, Rating.Again);

    cards = [{ ...createFlashCard('test-card'), state: state1 }];
    setupMock(cards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.isNew).toBe(false);

    // Second rating: Easy
    const { card: state2 } = computeNewState(state1, Rating.Easy);
    expect(state2.reps).toBe(2);

    cards = [{ ...createFlashCard('test-card'), state: state2 }];
    setupMock(cards);
    rerender();

    expect(result.current.remaining).toBe(0);
  });
});

// ============================================================================
// Undo Tests
// ============================================================================

describe('Undo', () => {
  function setupMock(cards: FlashCard[], logs: any[] = [], isLoading = false) {
    vi.mocked(useCards).mockReturnValue({ data: cards, isLoading });
    vi.mocked(useReviewLogs).mockReturnValue({ data: logs, isLoading });
  }

  function createReviewLog(
    cardId: string,
    opts: {
      isReverse?: boolean;
      rating?: number;
      state?: number;
      timestamp?: number;
    } = {}
  ) {
    const ts = opts.timestamp ?? Date.now();
    const direction = opts.isReverse ? 'reverse' : 'forward';
    return {
      id: `${cardId}:${direction}:${ts}`,
      cardId,
      isReverse: opts.isReverse ?? false,
      rating: opts.rating ?? Rating.Good,
      state: opts.state ?? 0,
      due: new Date().toISOString(),
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      last_elapsed_days: 0,
      scheduled_days: 1,
      review: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    vi.mocked(getCardRepository).mockReturnValue({
      updateState: vi.fn(() => Promise.resolve()),
      suspend: vi.fn(() => Promise.resolve()),
      getById: vi.fn(() => Promise.resolve(null)),
    } as any);
    vi.mocked(getReviewLogRepository).mockReturnValue({
      insert: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    } as any);
    vi.mocked(useSettings).mockReturnValue({
      settings: { newCardsPerDay: 10 },
      isLoading: false,
      update: vi.fn(),
      clear: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('canUndo', () => {
    it('is false when there are no review logs', () => {
      setupMock([createFlashCard('card-a')]);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.canUndo).toBe(false);
    });

    it('is true when any review log exists, regardless of current card', () => {
      // card-a was rated and left the queue; card-b is now current
      const { card: ratedState } = computeNewState(null, Rating.Easy);
      const cards = [
        { ...createFlashCard('card-a'), state: ratedState },
        createFlashCard('card-b'),
      ];
      const logs = [createReviewLog('test-deck|card-a', { timestamp: 1000 })];
      setupMock(cards, logs);

      const { result } = renderHook(() => useDeck('test-deck'));

      // Current card is card-b, but undo is available because card-a has a log
      expect(result.current.currentCard?.term).toBe('card-b');
      expect(result.current.canUndo).toBe(true);
    });

    it('is true even when no cards are in queue (session complete)', () => {
      const { card: ratedState } = computeNewState(null, Rating.Easy);
      const cards = [{ ...createFlashCard('card-a'), state: ratedState }];
      const logs = [createReviewLog('test-deck|card-a', { timestamp: 1000 })];
      setupMock(cards, logs);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard).toBeNull();
      expect(result.current.remaining).toBe(0);
      expect(result.current.canUndo).toBe(true);
    });
  });

  describe('undo targets most recent review', () => {
    it('undoes the most recently rated card, not the current card', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      const mockRemove = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
        getById: vi.fn(() => Promise.resolve(null)),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: vi.fn(() => Promise.resolve()),
        remove: mockRemove,
      } as any);

      // card-a was rated (has a log); card-b is now current
      const { card: ratedState } = computeNewState(null, Rating.Easy);
      const cards = [
        { ...createFlashCard('card-a'), state: ratedState },
        createFlashCard('card-b'),
      ];
      const logs = [
        createReviewLog('test-deck|card-a', { state: 0, timestamp: 1000 }),
      ];
      setupMock(cards, logs);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.term).toBe('card-b');

      await act(async () => {
        await result.current.undo();
      });

      // Should undo card-a (the most recent log), not card-b (current)
      expect(mockUpdateState).toHaveBeenCalledWith('test-deck|card-a', 'state', null);
      expect(mockRemove).toHaveBeenCalledWith(logs[0].id);
    });

    it('picks the latest log when multiple logs exist', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      const mockRemove = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
        getById: vi.fn(() => Promise.resolve(null)),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: vi.fn(() => Promise.resolve()),
        remove: mockRemove,
      } as any);

      const { card: stateA } = computeNewState(null, Rating.Easy);
      const { card: stateB } = computeNewState(null, Rating.Easy);
      const cards = [
        { ...createFlashCard('card-a'), state: stateA },
        { ...createFlashCard('card-b'), state: stateB },
      ];
      const logs = [
        createReviewLog('test-deck|card-a', { state: 0, timestamp: 1000 }),
        createReviewLog('test-deck|card-b', { state: 0, timestamp: 2000 }),
      ];
      setupMock(cards, logs);

      const { result } = renderHook(() => useDeck('test-deck'));

      await act(async () => {
        await result.current.undo();
      });

      // Should undo card-b (timestamp 2000 > 1000)
      expect(mockUpdateState).toHaveBeenCalledWith('test-deck|card-b', 'state', null);
      expect(mockRemove).toHaveBeenCalledWith(logs[1].id);
    });
  });

  describe('undo restores new cards', () => {
    it('restores a new card to null state (state=0 in log)', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
        getById: vi.fn(() => Promise.resolve(null)),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
      } as any);

      const { card: ratedState } = computeNewState(null, Rating.Good);
      const cards = [{ ...createFlashCard('card-a'), state: ratedState }];
      const logs = [
        createReviewLog('test-deck|card-a', { state: 0, timestamp: 1000 }),
      ];
      setupMock(cards, logs);

      const { result } = renderHook(() => useDeck('test-deck'));

      await act(async () => {
        await result.current.undo();
      });

      // state=0 means it was New → should restore to null, not a serialized empty card
      expect(mockUpdateState).toHaveBeenCalledWith('test-deck|card-a', 'state', null);
    });

    it('undone new card returns to its original position and becomes current', () => {
      // Simulate: cards a, b, c in deck order. User rated a and b, now on c.
      // After undoing b, b should become the current card.
      const { card: stateA } = computeNewState(null, Rating.Easy);
      const { card: stateB } = computeNewState(null, Rating.Easy);
      const cards = [
        { ...createFlashCard('card-a'), state: stateA },
        { ...createFlashCard('card-b'), state: stateB },
        createFlashCard('card-c'),
      ];
      const logs = [
        createReviewLog('test-deck|card-a', { state: 0, timestamp: 1000 }),
        createReviewLog('test-deck|card-b', { state: 0, timestamp: 2000 }),
      ];
      setupMock(cards, logs);

      const { result, rerender } = renderHook(() => useDeck('test-deck'));

      // Currently showing card-c (only new card left)
      expect(result.current.currentCard?.term).toBe('card-c');

      // After undo, card-b's state goes back to null (simulated by re-mocking)
      const undoneCards = [
        { ...createFlashCard('card-a'), state: stateA },
        createFlashCard('card-b'), // back to new (null state)
        createFlashCard('card-c'),
      ];
      setupMock(undoneCards, [logs[0]]); // only card-a's log remains
      rerender();

      // card-b is new again and comes before card-c in deck order
      expect(result.current.currentCard?.term).toBe('card-b');
      expect(result.current.currentCard?.isNew).toBe(true);
    });

    it('undone new reverse card restores reverseState to null', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
        getById: vi.fn(() => Promise.resolve(null)),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
      } as any);

      const { card: reverseState } = computeNewState(null, Rating.Good);
      const cards = [
        createFlashCard('gato', {
          reversible: true,
          state: createFutureState(5),
          reverseState,
        }),
      ];
      const logs = [
        createReviewLog('test-deck|gato', { isReverse: true, state: 0, timestamp: 1000 }),
      ];
      setupMock(cards, logs);

      const { result } = renderHook(() => useDeck('test-deck'));

      await act(async () => {
        await result.current.undo();
      });

      expect(mockUpdateState).toHaveBeenCalledWith('test-deck|gato', 'reverseState', null);
    });
  });

  describe('undo does nothing when no logs', () => {
    it('undo is a no-op when logsList is empty', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      const mockRemove = vi.fn(() => Promise.resolve());
      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
        getById: vi.fn(() => Promise.resolve(null)),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: vi.fn(() => Promise.resolve()),
        remove: mockRemove,
      } as any);

      setupMock([createFlashCard('card-a')]);

      const { result } = renderHook(() => useDeck('test-deck'));

      await act(async () => {
        await result.current.undo();
      });

      expect(mockUpdateState).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe('undo reviewed (non-new) card', () => {
    it('uses FSRS rollback for cards that were not new (state > 0)', async () => {
      const mockUpdateState = vi.fn(() => Promise.resolve());
      // First review
      const { card: state1 } = computeNewState(null, Rating.Good);
      // Second review
      const now = new Date(state1.due.getTime() + 1000);
      const { card: state2, log: log2 } = computeNewState(state1, Rating.Good, now);

      vi.mocked(getCardRepository).mockReturnValue({
        updateState: mockUpdateState,
        suspend: vi.fn(() => Promise.resolve()),
        getById: vi.fn(() => Promise.resolve({ ...createFlashCard('card-a'), state: state2 })),
      } as any);
      vi.mocked(getReviewLogRepository).mockReturnValue({
        insert: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
      } as any);

      const cards = [{ ...createFlashCard('card-a'), state: state2 }];
      const logs = [{
        id: `test-deck|card-a:forward:2000`,
        cardId: 'test-deck|card-a',
        isReverse: false,
        rating: log2.rating,
        state: log2.state, // state > 0 (not New)
        due: log2.due.toISOString(),
        stability: log2.stability,
        difficulty: log2.difficulty,
        elapsed_days: log2.elapsed_days,
        last_elapsed_days: log2.last_elapsed_days,
        scheduled_days: log2.scheduled_days,
        review: log2.review.toISOString(),
      }];
      setupMock(cards, logs);

      const { result } = renderHook(() => useDeck('test-deck'));

      await act(async () => {
        await result.current.undo();
      });

      // Should call updateState with a serialized FSRS card (not null)
      expect(mockUpdateState).toHaveBeenCalledWith(
        'test-deck|card-a',
        'state',
        expect.objectContaining({ due: expect.any(String), stability: expect.any(Number) })
      );
    });
  });
});
