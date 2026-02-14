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
import type { FlashCard } from '../../src/services/collections';

// ============================================================================
// Test Helpers
// ============================================================================

function createFlashCard(
  source: string,
  opts: {
    translation?: string;
    state?: Card | null;
    reverseState?: Card | null;
    reversible?: boolean;
    example?: string;
    notes?: string;
    deckName?: string;
  } = {}
): FlashCard {
  const deckName = opts.deckName ?? 'test-deck';
  return {
    id: `${deckName}|${source}`,
    deckName,
    source,
    translation: opts.translation ?? `${source}-translation`,
    tags: [],
    created: '2025-01-01',
    reversible: opts.reversible ?? false,
    example: opts.example,
    notes: opts.notes,
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
      expect(newItems[0].source).toBe('hello');
      expect(newItems[0].isReverse).toBe(false);
      expect(dueItems).toHaveLength(0);
    });

    it('includes due cards (past due date) in dueItems', () => {
      const cards = [createFlashCard('hello', { state: createPastState(1) })];
      const { newItems, dueItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(1);
      expect(dueItems[0].source).toBe('hello');
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
      expect(newItems[0].source).toBe('one');
      expect(newItems[1].source).toBe('two');
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

      // All forwards first, then reverses (limit of 3 reached)
      expect(newItems).toHaveLength(3);
      expect(newItems.map((i) => `${i.source}-${i.isReverse}`)).toEqual([
        'one-false',
        'two-false',
        'one-true',
      ]);
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
      expect(newItems[0].source).toBe('new-card');
      expect(dueItems).toHaveLength(1);
      expect(dueItems[0].source).toBe('due-card');
    });

    it('processes cards in order', () => {
      const cards = [
        createFlashCard('a'),
        createFlashCard('b'),
        createFlashCard('c'),
      ];
      const { newItems } = computeStudyItems(cards, 10, endOfDay);

      expect(newItems.map((i) => i.source)).toEqual(['a', 'b', 'c']);
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
      expect(newItems.map((i) => i.source)).toEqual(['one', 'two', 'three']);
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
      expect(newItems.map((i) => i.source)).toEqual(['introduced-a', 'introduced-b']);
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

    it('handles empty translation', () => {
      const endOfDay = getEndOfDay();
      const card = createFlashCard('test', { translation: '' });
      const { newItems } = computeStudyItems([card], 10, endOfDay);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].translation).toBe('');
    });

    it('handles very large newCardsLimit', () => {
      const endOfDay = getEndOfDay();
      const cards = [createFlashCard('one'), createFlashCard('two')];
      const { newItems } = computeStudyItems(cards, Number.MAX_SAFE_INTEGER, endOfDay);

      expect(newItems).toHaveLength(2);
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
  it('updates forward state via RxDB for non-reverse card', async () => {
    const mockPatch = vi.fn(() => Promise.resolve());
    const mockExec = vi.fn(() => Promise.resolve({ incrementalPatch: mockPatch }));
    const mockFindOne = vi.fn(() => ({ exec: mockExec }));
    const mockInsert = vi.fn(() => Promise.resolve());
    const { getDatabaseSync } = await import('../../src/services/rxdb');
    vi.mocked(getDatabaseSync).mockReturnValue({
      cards: { findOne: mockFindOne },
      reviewlogs: { insert: mockInsert },
    } as any);

    const card: StudyItem = {
      ...createFlashCard('hello'),
      isReverse: false,
    };

    await rateCard(card, Rating.Good);

    expect(mockFindOne).toHaveBeenCalledWith('test-deck|hello');
    expect(mockPatch).toHaveBeenCalledWith({ state: expect.any(Object) });
  });

  it('updates reverse state via RxDB for reverse card', async () => {
    const mockPatch = vi.fn(() => Promise.resolve());
    const mockExec = vi.fn(() => Promise.resolve({ incrementalPatch: mockPatch }));
    const mockFindOne = vi.fn(() => ({ exec: mockExec }));
    const mockInsert = vi.fn(() => Promise.resolve());
    const { getDatabaseSync } = await import('../../src/services/rxdb');
    vi.mocked(getDatabaseSync).mockReturnValue({
      cards: { findOne: mockFindOne },
      reviewlogs: { insert: mockInsert },
    } as any);

    const card: StudyItem = {
      ...createFlashCard('hello', { reversible: true }),
      isReverse: true,
    };

    await rateCard(card, Rating.Good);

    expect(mockPatch).toHaveBeenCalledWith({ reverseState: expect.any(Object) });
  });

  it('inserts a review log in RxDB when rating', async () => {
    const mockPatch = vi.fn(() => Promise.resolve());
    const mockExec = vi.fn(() => Promise.resolve({ incrementalPatch: mockPatch }));
    const mockFindOne = vi.fn(() => ({ exec: mockExec }));
    const mockInsert = vi.fn(() => Promise.resolve());
    const { getDatabaseSync } = await import('../../src/services/rxdb');
    vi.mocked(getDatabaseSync).mockReturnValue({
      cards: { findOne: mockFindOne },
      reviewlogs: { insert: mockInsert },
    } as any);

    const card: StudyItem = {
      ...createFlashCard('hello'),
      isReverse: false,
    };

    await rateCard(card, Rating.Good);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedLog = (mockInsert.mock.calls as any[][])[0][0];
    expect(insertedLog.cardSource).toBe('hello');
    expect(insertedLog.isReverse).toBe(false);
    expect(insertedLog.rating).toBe(Rating.Good);
  });
});

// ============================================================================
// useDeck Hook Integration Tests
// ============================================================================

// Mock modules
vi.mock('../../src/services/rxdb', () => ({
  getDatabaseSync: vi.fn(() => ({
    cards: {
      findOne: vi.fn(() => ({
        exec: vi.fn(() => Promise.resolve({
          incrementalPatch: vi.fn(() => Promise.resolve()),
        })),
      })),
    },
    settings: {},
    reviewlogs: {
      insert: vi.fn(() => Promise.resolve()),
      findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
    },
  })),
}));

vi.mock('../../src/hooks/useRxQuery', () => ({
  useRxQuery: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('../../src/services/replication', () => ({
  parseCardState: vi.fn((json: any) => ({
    ...json,
    due: new Date(json.due),
    last_review: json.last_review ? new Date(json.last_review) : undefined,
  })),
  notifyChange: vi.fn(),
}));

vi.mock('../../src/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '../../src/hooks/useSettings';
import { useRxQuery } from '../../src/hooks/useRxQuery';
import { getDatabaseSync } from '../../src/services/rxdb';

describe('useDeck hook', () => {
  let mockCards: FlashCard[];

  // Helper to set up query mocks for cards and logs (both useRxQuery now)
  function setupQueryMock(cards: FlashCard[], logs: any[] = [], isLoading = false) {
    vi.mocked(useRxQuery).mockImplementation((_collection: any, _query?: any) => {
      // Distinguish between cards and reviewlogs by checking if a query was passed
      if (_query) {
        return { data: cards, isLoading } as any;
      }
      return { data: logs, isLoading } as any;
    });
  }

  beforeEach(() => {
    mockCards = [];

    vi.mocked(getDatabaseSync).mockReturnValue({
      cards: {
        findOne: vi.fn(() => ({
          exec: vi.fn(() => Promise.resolve({
            incrementalPatch: vi.fn(() => Promise.resolve()),
          })),
        })),
      },
      settings: {},
      reviewlogs: {
        insert: vi.fn(() => Promise.resolve()),
        findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
      },
    } as any);
    vi.mocked(useSettings).mockReturnValue({
      settings: { newCardsPerDay: 10 },
      isLoading: false,
      update: vi.fn(),
      clear: vi.fn(),
    } as any);
    setupQueryMock(mockCards);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('returns isLoading true when query is loading', () => {
      setupQueryMock([], [], true);

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
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.source).toBe('new-card');
      expect(result.current.newItems).toHaveLength(1);
      expect(result.current.dueItems).toHaveLength(1);
    });

    it('maintains card order within categories', () => {
      mockCards = [
        createFlashCard('new-a'),
        createFlashCard('new-b'),
        createFlashCard('new-c'),
      ];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.newItems.map((i) => i.source)).toEqual([
        'new-a',
        'new-b',
        'new-c',
      ]);
    });
  });

  describe('currentCard display data', () => {
    it('sets front/back correctly for forward direction', () => {
      mockCards = [createFlashCard('hola', { translation: 'hello' })];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard).toEqual({
        source: 'hola',
        front: 'hola',
        back: 'hello',
        example: undefined,
        notes: undefined,
        isReverse: false,
        isNew: true,
      });
    });

    it('sets front/back correctly for reverse direction', () => {
      mockCards = [
        createFlashCard('hola', {
          translation: 'hello',
          reversible: true,
          state: createFutureState(5), // forward scheduled
          reverseState: null, // reverse is new
        }),
      ];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard).toEqual({
        source: 'hola',
        front: 'hello', // translation shown as front in reverse
        back: 'hola', // source shown as back in reverse
        example: undefined,
        notes: undefined,
        isReverse: true,
        isNew: true,
      });
    });

    it('includes example and notes when present', () => {
      mockCards = [
        createFlashCard('hola', {
          translation: 'hello',
          example: 'Hola, amigo!',
          notes: 'Common greeting',
        }),
      ];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.example).toBe('Hola, amigo!');
      expect(result.current.currentCard?.notes).toBe('Common greeting');
    });

    it('marks new cards as isNew true', () => {
      mockCards = [createFlashCard('new-card')];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isNew).toBe(true);
    });

    it('marks reviewed cards as isNew false', () => {
      mockCards = [createFlashCard('reviewed', { state: createPastState(1) })];
      setupQueryMock(mockCards);

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
      setupQueryMock(mockCards);

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
      setupQueryMock(mockCards);

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
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.remaining).toBe(3);
    });

    it('counts both directions of reversible cards', () => {
      mockCards = [createFlashCard('reversible', { reversible: true })];
      setupQueryMock(mockCards);

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
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.remaining).toBe(2);
    });
  });

  describe('rate function', () => {
    it('calls RxDB findOne with correct card ID when rating', async () => {
      const mockPatch = vi.fn(() => Promise.resolve());
      const mockExec = vi.fn(() => Promise.resolve({ incrementalPatch: mockPatch }));
      const mockFindOne = vi.fn(() => ({ exec: mockExec }));
      const mockInsert = vi.fn(() => Promise.resolve());
      vi.mocked(getDatabaseSync).mockReturnValue({
        cards: { findOne: mockFindOne },
        settings: {},
        reviewlogs: { insert: mockInsert, findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })) },
      } as any);

      mockCards = [createFlashCard('test-card')];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      // Allow async rateCard to complete
      await vi.waitFor(() => {
        expect(mockFindOne).toHaveBeenCalledWith('test-deck|test-card');
      });
    });

    it('does nothing when no current card', () => {
      const mockFindOne = vi.fn();
      const mockInsert = vi.fn();
      vi.mocked(getDatabaseSync).mockReturnValue({
        cards: { findOne: mockFindOne },
        settings: {},
        reviewlogs: { insert: mockInsert, findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })) },
      } as any);

      setupQueryMock([]);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      expect(mockFindOne).not.toHaveBeenCalled();
    });

    it('patches forward state for non-reverse card', async () => {
      const mockPatch = vi.fn(() => Promise.resolve());
      const mockExec = vi.fn(() => Promise.resolve({ incrementalPatch: mockPatch }));
      const mockFindOne = vi.fn(() => ({ exec: mockExec }));
      const mockInsert = vi.fn(() => Promise.resolve());
      vi.mocked(getDatabaseSync).mockReturnValue({
        cards: { findOne: mockFindOne },
        settings: {},
        reviewlogs: { insert: mockInsert, findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })) },
      } as any);

      mockCards = [createFlashCard('test-card')];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      await vi.waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith({ state: expect.any(Object) });
      });
    });

    it('patches reverse state for reverse card', async () => {
      const mockPatch = vi.fn(() => Promise.resolve());
      const mockExec = vi.fn(() => Promise.resolve({ incrementalPatch: mockPatch }));
      const mockFindOne = vi.fn(() => ({ exec: mockExec }));
      const mockInsert = vi.fn(() => Promise.resolve());
      vi.mocked(getDatabaseSync).mockReturnValue({
        cards: { findOne: mockFindOne },
        settings: {},
        reviewlogs: { insert: mockInsert, findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })) },
      } as any);

      mockCards = [
        createFlashCard('test-card', {
          reversible: true,
          state: createFutureState(5),
          reverseState: null,
        }),
      ];
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isReverse).toBe(true);

      act(() => {
        result.current.rate(Rating.Good);
      });

      await vi.waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith({ reverseState: expect.any(Object) });
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
      setupQueryMock(mockCards);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.newItems).toHaveLength(3);
      expect(result.current.remaining).toBe(3);
    });
  });

  describe('deck name handling', () => {
    it('calls useRxQuery with deckName selector', () => {
      renderHook(() => useDeck('my-spanish-deck'));

      expect(useRxQuery).toHaveBeenCalledWith(
        expect.anything(),
        { selector: { deckName: 'my-spanish-deck' }, sort: [{ created: 'asc' }] }
      );
    });
  });
});

// ============================================================================
// Study Session Flow Tests (Integration-style)
// ============================================================================

describe('Study Session Flow', () => {
  // Helper to set up query mocks for cards and logs (both useRxQuery now)
  function setupQueryMock(cards: FlashCard[], logs: any[] = [], isLoading = false) {
    vi.mocked(useRxQuery).mockImplementation((_collection: any, _query?: any) => {
      if (_query) {
        return { data: cards, isLoading } as any;
      }
      return { data: logs, isLoading } as any;
    });
  }

  beforeEach(() => {

    vi.mocked(getDatabaseSync).mockReturnValue({
      cards: {
        findOne: vi.fn(() => ({
          exec: vi.fn(() => Promise.resolve({
            incrementalPatch: vi.fn(() => Promise.resolve()),
          })),
        })),
      },
      settings: {},
      reviewlogs: {
        insert: vi.fn(() => Promise.resolve()),
        findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
      },
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
    setupQueryMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(2);
    expect(result.current.currentCard?.source).toBe('card-a');
    expect(result.current.currentCard?.isNew).toBe(true);

    // Simulate rating card-a as Easy
    const { card: state1 } = computeNewState(null, Rating.Easy);

    cards = [
      { ...createFlashCard('card-a'), state: state1 },
      createFlashCard('card-b'),
    ];
    setupQueryMock(cards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.source).toBe('card-b');

    // Simulate rating card-b as Easy
    const { card: state2 } = computeNewState(null, Rating.Easy);

    cards = [
      { ...createFlashCard('card-a'), state: state1 },
      { ...createFlashCard('card-b'), state: state2 },
    ];
    setupQueryMock(cards);
    rerender();

    expect(result.current.remaining).toBe(0);
    expect(result.current.currentCard).toBeNull();
  });

  it('Again keeps card in session (due immediately)', () => {
    const cards = [createFlashCard('test-card')];
    setupQueryMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));
    expect(result.current.remaining).toBe(1);

    // Simulate rating Again
    const { card: newState } = computeNewState(null, Rating.Again);

    const updatedCards = [{ ...createFlashCard('test-card'), state: newState }];
    setupQueryMock(updatedCards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.source).toBe('test-card');
    expect(result.current.currentCard?.isNew).toBe(false);
  });

  it('Easy removes card from session (scheduled for future)', () => {
    const cards = [createFlashCard('test-card')];
    setupQueryMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));
    expect(result.current.remaining).toBe(1);

    // Simulate rating Easy
    const { card: newState } = computeNewState(null, Rating.Easy);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    expect(newState.due.getTime()).toBeGreaterThan(endOfToday.getTime());

    const updatedCards = [{ ...createFlashCard('test-card'), state: newState }];
    setupQueryMock(updatedCards);
    rerender();

    expect(result.current.remaining).toBe(0);
    expect(result.current.currentCard).toBeNull();
  });

  it('handles reversible card session with both directions', () => {
    const cards = [createFlashCard('gato', { translation: 'cat', reversible: true })];
    setupQueryMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(2);
    expect(result.current.currentCard?.front).toBe('gato');
    expect(result.current.currentCard?.isReverse).toBe(false);

    // Simulate forward rated as Easy (scheduled for future)
    const { card: forwardState } = computeNewState(null, Rating.Easy);

    const updatedCards = [
      {
        ...createFlashCard('gato', { translation: 'cat', reversible: true }),
        state: forwardState,
        reverseState: null,
      },
    ];
    setupQueryMock(updatedCards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.front).toBe('cat');
    expect(result.current.currentCard?.back).toBe('gato');
    expect(result.current.currentCard?.isReverse).toBe(true);
  });

  it('Good on new card keeps it in session (learning phase)', () => {
    const cards = [createFlashCard('test-card')];
    setupQueryMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.isNew).toBe(true);

    // Simulate rating Good
    const { card: newState } = computeNewState(null, Rating.Good);

    const updatedCards = [{ ...createFlashCard('test-card'), state: newState }];
    setupQueryMock(updatedCards);
    rerender();

    expect(result.current.currentCard?.isNew).toBe(false);
  });

  it('multiple ratings update state correctly', () => {
    let cards = [createFlashCard('test-card')];
    setupQueryMock(cards);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    // First rating: Again
    const { card: state1 } = computeNewState(null, Rating.Again);

    cards = [{ ...createFlashCard('test-card'), state: state1 }];
    setupQueryMock(cards);
    rerender();

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.isNew).toBe(false);

    // Second rating: Easy
    const { card: state2 } = computeNewState(state1, Rating.Easy);
    expect(state2.reps).toBe(2);

    cards = [{ ...createFlashCard('test-card'), state: state2 }];
    setupQueryMock(cards);
    rerender();

    expect(result.current.remaining).toBe(0);
  });
});
