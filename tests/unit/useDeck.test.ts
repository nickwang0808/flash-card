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
  } = {}
): FlashCard {
  return {
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

      // one-forward, one-reverse, two-forward (limit reached)
      expect(newItems).toHaveLength(3);
      expect(newItems.map((i) => `${i.source}-${i.isReverse}`)).toEqual([
        'one-false',
        'one-true',
        'two-false',
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
      const newState = computeNewState(null, Rating.Good, now);

      expect(newState.reps).toBe(1);
      expect(newState.due.getTime()).toBeGreaterThan(now.getTime());
    });

    it('all ratings create valid state', () => {
      const ratings: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

      for (const rating of ratings) {
        const state = computeNewState(null, rating, now);
        expect(state.reps).toBeGreaterThanOrEqual(0);
        expect(state.due).toBeInstanceOf(Date);
      }
    });
  });

  describe('rating intervals', () => {
    it('Again produces shortest interval', () => {
      const again = computeNewState(null, Rating.Again, now);
      const hard = computeNewState(null, Rating.Hard, now);
      const good = computeNewState(null, Rating.Good, now);
      const easy = computeNewState(null, Rating.Easy, now);

      expect(again.due.getTime()).toBeLessThanOrEqual(hard.due.getTime());
      expect(hard.due.getTime()).toBeLessThanOrEqual(good.due.getTime());
      expect(good.due.getTime()).toBeLessThanOrEqual(easy.due.getTime());
    });

    it('Easy produces longest interval', () => {
      const again = computeNewState(null, Rating.Again, now);
      const easy = computeNewState(null, Rating.Easy, now);

      expect(easy.due.getTime()).toBeGreaterThan(again.due.getTime());
    });

    it('Again on new card is due very soon (within minutes)', () => {
      const state = computeNewState(null, Rating.Again, now);
      const diffMinutes = (state.due.getTime() - now.getTime()) / (1000 * 60);

      expect(diffMinutes).toBeLessThan(60); // Within an hour
    });

    it('Easy on new card is due in days', () => {
      const state = computeNewState(null, Rating.Easy, now);
      const diffDays = (state.due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeGreaterThan(1);
    });
  });

  describe('updating existing state', () => {
    it('increments reps on each review', () => {
      let state = computeNewState(null, Rating.Good, now);
      expect(state.reps).toBe(1);

      state = computeNewState(state, Rating.Good, new Date(state.due.getTime() + 1000));
      expect(state.reps).toBe(2);

      state = computeNewState(state, Rating.Good, new Date(state.due.getTime() + 1000));
      expect(state.reps).toBe(3);
    });

    it('maintains learning progress with Good ratings', () => {
      let state = computeNewState(null, Rating.Good, now);
      const intervals: number[] = [];

      for (let i = 0; i < 5; i++) {
        const nextReview = new Date(state.due.getTime() + 1000);
        const prevDue = state.due;
        state = computeNewState(state, Rating.Good, nextReview);
        intervals.push(state.due.getTime() - prevDue.getTime());
      }

      // Intervals should generally increase (spaced repetition)
      // Not strictly increasing due to FSRS algorithm nuances
      expect(intervals[intervals.length - 1]).toBeGreaterThan(intervals[0]);
    });
  });

  describe('state validity', () => {
    it('returns valid Card object with all required fields', () => {
      const state = computeNewState(null, Rating.Good, now);

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
        const state = computeNewState(null, rating, now);
        expect(state.due).toBeInstanceOf(Date);
        expect(isNaN(state.due.getTime())).toBe(false);
      }
    });
  });

  describe('Hard and Good behavior on new cards', () => {
    it('Good on new card may still be due today (learning phase)', () => {
      const state = computeNewState(null, Rating.Good, now);
      // FSRS Good on new card typically schedules for ~10 minutes, still within today
      // This is the expected behavior - card stays in session for learning
      expect(state.reps).toBe(1);
    });

    it('Hard on new card schedules for very short interval', () => {
      const state = computeNewState(null, Rating.Hard, now);
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
  it('calls collection.update with correct key', () => {
    const mockUpdate = vi.fn();
    const mockCollection = { update: mockUpdate } as any;

    const card: StudyItem = {
      ...createFlashCard('hello'),
      isReverse: false,
    };

    rateCard(mockCollection, card, Rating.Good);

    expect(mockUpdate).toHaveBeenCalledWith('hello', expect.any(Function));
  });

  it('updates forward state for non-reverse card', () => {
    const mockUpdate = vi.fn();
    const mockCollection = { update: mockUpdate } as any;

    const card: StudyItem = {
      ...createFlashCard('hello'),
      isReverse: false,
    };

    rateCard(mockCollection, card, Rating.Good);

    // Get the updater function and test it
    const updater = mockUpdate.mock.calls[0][1];
    const draft = { state: null, reverseState: null };
    updater(draft);

    expect(draft.state).not.toBeNull();
    expect(draft.reverseState).toBeNull();
  });

  it('updates reverse state for reverse card', () => {
    const mockUpdate = vi.fn();
    const mockCollection = { update: mockUpdate } as any;

    const card: StudyItem = {
      ...createFlashCard('hello', { reversible: true }),
      isReverse: true,
    };

    rateCard(mockCollection, card, Rating.Good);

    const updater = mockUpdate.mock.calls[0][1];
    const draft = { state: null, reverseState: null };
    updater(draft);

    expect(draft.state).toBeNull();
    expect(draft.reverseState).not.toBeNull();
  });
});

// ============================================================================
// useDeck Hook Integration Tests
// ============================================================================

// Mock modules
vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn(),
}));

vi.mock('../../src/services/collections', () => ({
  getCardsCollection: vi.fn(),
}));

vi.mock('../../src/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useLiveQuery } from '@tanstack/react-db';
import { getCardsCollection } from '../../src/services/collections';
import { useSettings } from '../../src/hooks/useSettings';

describe('useDeck hook', () => {
  let mockCollection: { update: ReturnType<typeof vi.fn> };
  let mockCards: FlashCard[];

  beforeEach(() => {
    mockCollection = { update: vi.fn() };
    mockCards = [];

    vi.mocked(getCardsCollection).mockReturnValue(mockCollection as any);
    vi.mocked(useSettings).mockReturnValue({
      settings: { newCardsPerDay: 10 },
      isLoading: false,
      update: vi.fn(),
      clear: vi.fn(),
    } as any);
    vi.mocked(useLiveQuery).mockReturnValue({
      data: mockCards,
      isLoading: false,
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('returns isLoading true when query is loading', () => {
      vi.mocked(useLiveQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.example).toBe('Hola, amigo!');
      expect(result.current.currentCard?.notes).toBe('Common greeting');
    });

    it('marks new cards as isNew true', () => {
      mockCards = [createFlashCard('new-card')];
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.currentCard?.isNew).toBe(true);
    });

    it('marks reviewed cards as isNew false', () => {
      mockCards = [createFlashCard('reviewed', { state: createPastState(1) })];
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.remaining).toBe(3);
    });

    it('counts both directions of reversible cards', () => {
      mockCards = [createFlashCard('reversible', { reversible: true })];
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.remaining).toBe(2);
    });
  });

  describe('rate function', () => {
    it('calls collection.update when rating', () => {
      mockCards = [createFlashCard('test-card')];
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      expect(mockCollection.update).toHaveBeenCalledWith(
        'test-card',
        expect.any(Function)
      );
    });

    it('does nothing when no current card', () => {
      // Empty deck
      vi.mocked(useLiveQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      expect(mockCollection.update).not.toHaveBeenCalled();
    });

    it('updates forward state for non-reverse card', () => {
      mockCards = [createFlashCard('test-card')];
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      act(() => {
        result.current.rate(Rating.Good);
      });

      const updater = mockCollection.update.mock.calls[0][1];
      const draft: { state: Card | null; reverseState: Card | null } = { state: null, reverseState: null };
      updater(draft);

      expect(draft.state).not.toBeNull();
      expect(draft.state!.reps).toBe(1);
      expect(draft.reverseState).toBeNull();
    });

    it('updates reverse state for reverse card', () => {
      mockCards = [
        createFlashCard('test-card', {
          reversible: true,
          state: createFutureState(5), // forward already reviewed
          reverseState: null, // reverse is new (will be shown first as new)
        }),
      ];
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      // First card should be the reverse (new) direction
      expect(result.current.currentCard?.isReverse).toBe(true);

      act(() => {
        result.current.rate(Rating.Good);
      });

      const updater = mockCollection.update.mock.calls[0][1];
      const draft: { state: Card | null; reverseState: Card | null } = { state: createFutureState(5), reverseState: null };
      updater(draft);

      expect(draft.reverseState).not.toBeNull();
      expect(draft.reverseState!.reps).toBe(1);
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
      vi.mocked(useLiveQuery).mockReturnValue({
        data: mockCards,
        isLoading: false,
      } as any);

      const { result } = renderHook(() => useDeck('test-deck'));

      expect(result.current.newItems).toHaveLength(3);
      expect(result.current.remaining).toBe(3);
    });
  });

  describe('deck name handling', () => {
    it('passes deck name to getCardsCollection', () => {
      renderHook(() => useDeck('my-spanish-deck'));

      expect(getCardsCollection).toHaveBeenCalledWith('my-spanish-deck');
    });

    it('passes deck name to useLiveQuery dependencies', () => {
      renderHook(() => useDeck('my-deck'));

      expect(useLiveQuery).toHaveBeenCalledWith(expect.any(Function), ['my-deck']);
    });
  });
});

// ============================================================================
// Study Session Flow Tests (Integration-style)
// ============================================================================

describe('Study Session Flow', () => {
  let mockCollection: { update: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockCollection = { update: vi.fn() };
    vi.mocked(getCardsCollection).mockReturnValue(mockCollection as any);
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

    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    // Initial state: 2 cards remaining, first is card-a
    expect(result.current.remaining).toBe(2);
    expect(result.current.currentCard?.source).toBe('card-a');
    expect(result.current.currentCard?.isNew).toBe(true);

    // Rate first card as Easy - simulates it being scheduled for future
    act(() => {
      result.current.rate(Rating.Easy);
    });

    // Simulate the reactive update: card-a now has state (scheduled for future)
    const updater1 = mockCollection.update.mock.calls[0][1];
    const card1Draft = { state: null, reverseState: null };
    updater1(card1Draft);

    cards = [
      { ...createFlashCard('card-a'), state: card1Draft.state },
      createFlashCard('card-b'),
    ];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    rerender();

    // Now only 1 card remaining (card-a is scheduled for future)
    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.source).toBe('card-b');

    // Rate second card as Easy (to ensure it's scheduled for future)
    act(() => {
      result.current.rate(Rating.Easy);
    });

    // Simulate reactive update
    const updater2 = mockCollection.update.mock.calls[1][1];
    const card2Draft = { state: null, reverseState: null };
    updater2(card2Draft);

    cards = [
      { ...createFlashCard('card-a'), state: card1Draft.state },
      { ...createFlashCard('card-b'), state: card2Draft.state },
    ];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    rerender();

    // Session complete
    expect(result.current.remaining).toBe(0);
    expect(result.current.currentCard).toBeNull();
  });

  it('Again keeps card in session (due immediately)', () => {
    const cards = [createFlashCard('test-card')];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(1);

    // Rate as Again
    act(() => {
      result.current.rate(Rating.Again);
    });

    // Simulate the state update - Again schedules for very soon
    const updater = mockCollection.update.mock.calls[0][1];
    const draft = { state: null, reverseState: null };
    updater(draft);

    // Card should be due immediately/very soon (within today)
    const updatedCards = [{ ...createFlashCard('test-card'), state: draft.state }];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: updatedCards,
      isLoading: false,
    } as any);

    rerender();

    // Card should still be in session (due today)
    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.source).toBe('test-card');
    expect(result.current.currentCard?.isNew).toBe(false); // Now has state
  });

  it('Easy removes card from session (scheduled for future)', () => {
    const cards = [createFlashCard('test-card')];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(1);

    // Rate as Easy
    act(() => {
      result.current.rate(Rating.Easy);
    });

    // Simulate the state update - Easy schedules for future
    const updater = mockCollection.update.mock.calls[0][1];
    const draft: { state: Card | null; reverseState: Card | null } = { state: null, reverseState: null };
    updater(draft);

    // Verify the due date is in the future (beyond end of today)
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    expect(draft.state!.due.getTime()).toBeGreaterThan(endOfToday.getTime());

    // Update mock with new state
    const updatedCards = [{ ...createFlashCard('test-card'), state: draft.state }];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: updatedCards,
      isLoading: false,
    } as any);

    rerender();

    // Card should be removed from session
    expect(result.current.remaining).toBe(0);
    expect(result.current.currentCard).toBeNull();
  });

  it('handles reversible card session with both directions', () => {
    const cards = [createFlashCard('gato', { translation: 'cat', reversible: true })];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    // Both directions are new
    expect(result.current.remaining).toBe(2);
    expect(result.current.currentCard?.front).toBe('gato'); // Forward first
    expect(result.current.currentCard?.isReverse).toBe(false);

    // Rate forward direction as Easy
    act(() => {
      result.current.rate(Rating.Easy);
    });

    const forwardUpdater = mockCollection.update.mock.calls[0][1];
    const forwardDraft = { state: null, reverseState: null };
    forwardUpdater(forwardDraft);

    // Update: forward is now scheduled for future
    const updatedCards = [
      {
        ...createFlashCard('gato', { translation: 'cat', reversible: true }),
        state: forwardDraft.state, // scheduled for future
        reverseState: null, // still new
      },
    ];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: updatedCards,
      isLoading: false,
    } as any);

    rerender();

    // Only reverse direction remains
    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.front).toBe('cat'); // Reverse shows translation as front
    expect(result.current.currentCard?.back).toBe('gato');
    expect(result.current.currentCard?.isReverse).toBe(true);
  });

  it('Good on new card keeps it in session (learning phase)', () => {
    const cards = [createFlashCard('test-card')];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.isNew).toBe(true);

    // Rate as Good
    act(() => {
      result.current.rate(Rating.Good);
    });

    // Simulate the state update
    const updater = mockCollection.update.mock.calls[0][1];
    const draft = { state: null, reverseState: null };
    updater(draft);

    // Good on a new card schedules for a short interval (learning phase)
    // It should still be due within today
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const updatedCards = [{ ...createFlashCard('test-card'), state: draft.state }];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: updatedCards,
      isLoading: false,
    } as any);

    rerender();

    // Card may still be in session (learning phase) or may have graduated
    // depending on FSRS parameters - verify state was updated
    expect(result.current.currentCard?.isNew).toBe(false);
  });

  it('multiple ratings update state correctly', () => {
    let cards = [createFlashCard('test-card')];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    const { result, rerender } = renderHook(() => useDeck('test-deck'));

    // First rating: Again
    act(() => {
      result.current.rate(Rating.Again);
    });

    const updater1 = mockCollection.update.mock.calls[0][1];
    const draft1 = { state: null, reverseState: null };
    updater1(draft1);

    cards = [{ ...createFlashCard('test-card'), state: draft1.state }];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    rerender();

    // Card should still be in session after Again
    expect(result.current.remaining).toBe(1);
    expect(result.current.currentCard?.isNew).toBe(false);

    // Second rating: Easy (should schedule for future)
    act(() => {
      result.current.rate(Rating.Easy);
    });

    const updater2 = mockCollection.update.mock.calls[1][1];
    const draft2: { state: Card | null; reverseState: Card | null } = { state: draft1.state, reverseState: null };
    updater2(draft2);

    // Verify reps increased
    expect(draft2.state!.reps).toBe(2);

    cards = [{ ...createFlashCard('test-card'), state: draft2.state }];
    vi.mocked(useLiveQuery).mockReturnValue({
      data: cards,
      isLoading: false,
    } as any);

    rerender();

    // After Easy, card should be scheduled for future
    expect(result.current.remaining).toBe(0);
  });
});
