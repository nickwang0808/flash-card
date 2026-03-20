import { describe, it, expect } from 'vitest';
import { createEmptyCard, Rating, type Card, type Grade } from 'ts-fsrs';
import {
  computeStudyItems,
  computeNewState,
  formatInterval,
  type FlashCard,
} from '../../src/hooks/useDeck';

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
    order?: number;
    suspended?: boolean;
  } = {}
): FlashCard {
  const deckName = opts.deckName ?? 'test-deck';
  return {
    id: `${deckName}::${term}`,
    deckName,
    term,
    front: opts.front,
    back: opts.back ?? `${term}-translation`,
    tags: [],
    created: '2025-01-01',
    reversible: opts.reversible ?? false,
    order: opts.order ?? 0,
    state: opts.state ?? null,
    reverseState: opts.reverseState ?? null,
    suspended: opts.suspended,
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
  function getNow(): Date {
    return new Date();
  }

  describe('basic filtering', () => {
    const now = getNow();
    it('returns empty arrays for empty cards', () => {
      const { newItems, dueItems } = computeStudyItems([], 10, now);
      expect(newItems).toEqual([]);
      expect(dueItems).toEqual([]);
    });

    it('includes cards without state as new items', () => {
      const cards = [createFlashCard('hello')];
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].term).toBe('hello');
      expect(newItems[0].isReverse).toBe(false);
      expect(dueItems).toHaveLength(0);
    });

    it('includes due cards (past due date) in dueItems', () => {
      const cards = [createFlashCard('hello', { state: createPastState(1) })];
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(1);
      expect(dueItems[0].term).toBe('hello');
    });

    it('includes cards due in the past in dueItems', () => {
      const cards = [createFlashCard('hello', { state: createPastState(1) })];
      const { dueItems } = computeStudyItems(cards, 10, now);

      expect(dueItems).toHaveLength(1);
    });

    it('excludes cards scheduled for the future', () => {
      const cards = [createFlashCard('hello', { state: createFutureState(5) })];
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(0);
    });
  });

  describe('newCardsLimit', () => {
    const now = getNow();

    it('respects newCardsLimit for new cards', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
        createFlashCard('four'),
      ];
      const { newItems } = computeStudyItems(cards, 2, now);

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
      const { dueItems } = computeStudyItems(cards, 1, now);

      expect(dueItems).toHaveLength(3);
    });

    it('limit of 0 means no new cards', () => {
      const cards = [createFlashCard('one'), createFlashCard('two')];
      const { newItems } = computeStudyItems(cards, 0, now);

      expect(newItems).toHaveLength(0);
    });
  });

  describe('reversible cards', () => {
    const now = getNow();

    it('includes both directions for reversible cards', () => {
      const cards = [createFlashCard('hello', { reversible: true })];
      const { newItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(2);
      expect(newItems[0].isReverse).toBe(false);
      expect(newItems[1].isReverse).toBe(true);
    });

    it('counts both directions against newCardsLimit', () => {
      const cards = [
        createFlashCard('one', { reversible: true }),
        createFlashCard('two', { reversible: true }),
      ];
      const { newItems } = computeStudyItems(cards, 3, now);

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
      const { newItems } = computeStudyItems(cards, 3, now);

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
      const { newItems } = computeStudyItems(cards, 3, now);

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
      const { newItems } = computeStudyItems(cards, 5, now);

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
      const { newItems } = computeStudyItems(cards, 10, now);

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
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

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
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

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
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

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
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(0);
    });
  });

  describe('mixed scenarios', () => {
    const now = getNow();

    it('separates new and due cards correctly', () => {
      const cards = [
        createFlashCard('new-card'),
        createFlashCard('due-card', { state: createPastState(1) }),
        createFlashCard('future-card', { state: createFutureState(5) }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

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
      const { newItems } = computeStudyItems(cards, 10, now);

      expect(newItems.map((i) => i.term)).toEqual(['a', 'b', 'c']);
    });

    it('preserves input order for cards with identical created timestamps', () => {
      // All cards have the same created date (default '2025-01-01')
      const cards = [
        createFlashCard('一', { order: 0 }),
        createFlashCard('二', { order: 1 }),
        createFlashCard('三', { order: 2 }),
        createFlashCard('四', { order: 3 }),
        createFlashCard('五', { order: 4 }),
      ];
      const { newItems } = computeStudyItems(cards, 10, now);

      expect(newItems.map((i) => i.term)).toEqual(['一', '二', '三', '四', '五']);
    });
  });

  describe('introducedToday tracking', () => {
    const now = getNow();

    it('counts already-introduced cards toward limit', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
        createFlashCard('four'),
      ];
      // Simulate 2 cards already introduced today
      const introducedToday = new Set(['one', 'two']);

      const { newItems } = computeStudyItems(cards, 3, now, introducedToday);

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

      const { newItems } = computeStudyItems(cards, 2, now, introducedToday);

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

      const { newItems } = computeStudyItems(cards, 2, now, introducedToday);

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

      const { newItems } = computeStudyItems(cards, 1, now, introducedToday);

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

      const { newItems } = computeStudyItems(cards, 10, now, introducedToday);

      expect(newItems).toHaveLength(2);
    });

    it('works with default empty set when not provided', () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
      ];

      // Call without introducedToday parameter
      const { newItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(2);
    });
  });

  describe('suspended card filtering', () => {
    const now = getNow();

    it('excludes suspended cards from new items', () => {
      const cards = [
        createFlashCard('active'),
        createFlashCard('suspended-card', { suspended: true }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].term).toBe('active');
      expect(dueItems).toHaveLength(0);
    });

    it('excludes suspended cards from due items', () => {
      const cards = [
        createFlashCard('active-due', { state: createPastState(1) }),
        createFlashCard('suspended-due', { state: createPastState(1), suspended: true }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(1);
      expect(dueItems[0].term).toBe('active-due');
    });

    it('excludes suspended reversible cards from both directions', () => {
      const cards = [
        createFlashCard('active-rev', { reversible: true }),
        createFlashCard('suspended-rev', { reversible: true, suspended: true }),
      ];
      const { newItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(2);
      expect(newItems.every(i => i.term === 'active-rev')).toBe(true);
    });

    it('does not count suspended cards toward newCardsLimit', () => {
      const cards = [
        createFlashCard('suspended-1', { suspended: true }),
        createFlashCard('suspended-2', { suspended: true }),
        createFlashCard('active-1'),
        createFlashCard('active-2'),
        createFlashCard('active-3'),
      ];
      const { newItems } = computeStudyItems(cards, 3, now);

      expect(newItems).toHaveLength(3);
      expect(newItems.map(i => i.term)).toEqual(['active-1', 'active-2', 'active-3']);
    });

    it('treats suspended: false as active', () => {
      const cards = [
        createFlashCard('explicit-false', { suspended: false }),
      ];
      const { newItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].term).toBe('explicit-false');
    });

    it('treats suspended: undefined as active', () => {
      const cards = [
        createFlashCard('no-suspended-field'),
      ];
      // suspended is undefined by default in createFlashCard
      expect(cards[0].suspended).toBeUndefined();
      const { newItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(1);
    });

    it('returns empty when all cards are suspended', () => {
      const cards = [
        createFlashCard('a', { suspended: true }),
        createFlashCard('b', { suspended: true }),
        createFlashCard('c', { state: createPastState(1), suspended: true }),
      ];
      const { newItems, dueItems } = computeStudyItems(cards, 10, now);

      expect(newItems).toHaveLength(0);
      expect(dueItems).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('card due exactly now is included', () => {
      const now = getNow();
      const cardDueNow = createFlashCard('boundary', {
        state: createDueState(now),
      });
      const { dueItems } = computeStudyItems([cardDueNow], 10, now);

      expect(dueItems).toHaveLength(1);
    });

    it('card due 1ms in the future is excluded', () => {
      const now = getNow();
      const soon = new Date(now.getTime() + 1);
      const cardDueSoon = createFlashCard('soon', {
        state: createDueState(soon),
      });
      const { dueItems } = computeStudyItems([cardDueSoon], 10, now);

      expect(dueItems).toHaveLength(0);
    });

    it('non-reversible card ignores reverseState', () => {
      const now = getNow();
      // Card marked as non-reversible but has reverseState (data inconsistency)
      const card = createFlashCard('inconsistent', {
        reversible: false,
        state: null, // forward is new
        reverseState: createPastState(1), // should be ignored
      });
      const { newItems, dueItems } = computeStudyItems([card], 10, now);

      // Only forward direction should appear
      expect(newItems).toHaveLength(1);
      expect(newItems[0].isReverse).toBe(false);
      expect(dueItems).toHaveLength(0); // reverse ignored
    });

    it('handles empty back', () => {
      const now = getNow();
      const card = createFlashCard('test', { back: '' });
      const { newItems } = computeStudyItems([card], 10, now);

      expect(newItems).toHaveLength(1);
      expect(newItems[0].back).toBe('');
    });

    it('handles very large newCardsLimit', () => {
      const now = getNow();
      const cards = [createFlashCard('one'), createFlashCard('two')];
      const { newItems } = computeStudyItems(cards, Number.MAX_SAFE_INTEGER, now);

      expect(newItems).toHaveLength(2);
    });
  });

  describe('learning card ordering', () => {
    it('sorts learning cards after overdue review cards in dueItems', () => {
      const now = getNow();

      // Simulate: card1 was just rated "Again" (Learning state, due in 1 min)
      const { card: learningState } = computeNewState(null, Rating.Again);

      // card2 is an overdue review card (due yesterday)
      const cards = [
        createFlashCard('just-rated-again', { state: learningState }),
        createFlashCard('overdue-review', { state: createPastState(1) }),
      ];

      const { dueItems } = computeStudyItems(cards, 10, now);

      expect(dueItems).toHaveLength(2);
      // Overdue review card should come first, not the just-rated learning card
      expect(dueItems[0].term).toBe('overdue-review');
      expect(dueItems[1].term).toBe('just-rated-again');
    });

    it('sorts multiple learning cards by due time (oldest due first)', () => {
      const now = getNow();

      // card1 rated "Again" 5 minutes ago (due 4 min ago)
      const pastTime = new Date(Date.now() - 5 * 60 * 1000);
      const { card: olderLearning } = computeNewState(null, Rating.Again, pastTime);

      // card2 rated "Again" just now (due in 1 min)
      const { card: newerLearning } = computeNewState(null, Rating.Again);

      const cards = [
        createFlashCard('newer-again', { state: newerLearning }),
        createFlashCard('older-again', { state: olderLearning }),
      ];

      const { dueItems } = computeStudyItems(cards, 10, now);

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
// formatInterval Tests
// ============================================================================

describe('formatInterval', () => {
  const now = new Date('2025-06-01T12:00:00Z');

  it('returns minutes for intervals under 1 hour', () => {
    const due = new Date(now.getTime() + 5 * 60 * 1000);
    expect(formatInterval(due, now)).toBe('5m');
  });

  it('rounds minutes', () => {
    const due = new Date(now.getTime() + 90 * 1000);
    expect(formatInterval(due, now)).toBe('2m');
  });

  it('returns hours for intervals 1h to 24h', () => {
    const due = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    expect(formatInterval(due, now)).toBe('3h');
  });

  it('returns days for intervals 1d to 29d', () => {
    const due = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(formatInterval(due, now)).toBe('7d');
  });

  it('returns months for intervals 30d+', () => {
    const due = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    expect(formatInterval(due, now)).toBe('2mo');
  });

  it('boundary: exactly 60 minutes returns hours', () => {
    const due = new Date(now.getTime() + 60 * 60 * 1000);
    expect(formatInterval(due, now)).toBe('1h');
  });

  it('boundary: exactly 24 hours returns days', () => {
    const due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(formatInterval(due, now)).toBe('1d');
  });

  it('boundary: exactly 30 days returns months', () => {
    const due = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(formatInterval(due, now)).toBe('1mo');
  });

  it('uses current time as default now', () => {
    const due = new Date(Date.now() + 5 * 60 * 1000);
    expect(formatInterval(due)).toBe('5m');
  });
});

// NOTE: Hook integration tests (useDeck, rateCard, undo, etc.) have been
// removed from this file — they required complex RxDB mock wiring.
// These behaviors are covered by the E2E test suite instead.
// Pure function tests above (computeStudyItems, computeNewState, formatInterval)
// cover the core FSRS logic without any mocks.

/* eslint-disable @typescript-eslint/no-unused-vars */
// Keep this to prevent vitest from complaining about an empty trailing section
void 0;
