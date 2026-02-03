import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Rating } from '../../src/utils/fsrs';

// Mock the collections module
vi.mock('../../src/services/collections', () => {
  const mockCards = [
    { id: 'test-deck/hola', deckName: 'test-deck', source: 'hola', translation: 'hello', reversible: false },
    { id: 'test-deck/gato', deckName: 'test-deck', source: 'gato', translation: 'cat', reversible: true },
    { id: 'test-deck/perro', deckName: 'test-deck', source: 'perro', translation: 'dog', reversible: false },
  ];

  return {
    cardsCollection: {
      get toArray() {
        return mockCards;
      },
      toArrayWhenReady: () => Promise.resolve(mockCards),
    },
    cardStatesCollection: {
      toArrayWhenReady: () => Promise.resolve([]),
    },
    reviewCard: async () => ({ reps: 1, due: new Date().toISOString(), suspended: false }),
    getCardState: () => ({ reps: 0, due: new Date().toISOString(), suspended: false }),
    getPendingCount: () => Promise.resolve(0),
  };
});

import { reviewSession } from '../../src/services/review-session';

describe('ReviewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(
      'flash-card-settings',
      JSON.stringify({ repoUrl: 'x', token: 'x', newCardsPerDay: 10, reviewOrder: 'random', theme: 'system' }),
    );
    reviewSession.end();
  });

  it('starts a session with cards', async () => {
    await reviewSession.start('test-deck');
    expect(reviewSession.isActive()).toBe(true);
    const state = reviewSession.getState();
    expect(state).not.toBeNull();
    expect(state!.total).toBeGreaterThan(0);
  });

  it('getCurrentCard returns a card', async () => {
    await reviewSession.start('test-deck');
    const card = reviewSession.getCurrentCard();
    expect(card).not.toBeNull();
    expect(card!.source).toBeDefined();
  });

  it('showAnswer reveals the answer', async () => {
    await reviewSession.start('test-deck');
    expect(reviewSession.getState()!.answerRevealed).toBe(false);
    reviewSession.showAnswer();
    expect(reviewSession.getState()!.answerRevealed).toBe(true);
  });

  it('rating advances to next card', async () => {
    await reviewSession.start('test-deck');
    reviewSession.showAnswer();
    await reviewSession.rate(Rating.Good);

    expect(reviewSession.getState()!.done).toBe(1);
  });

  it('skip advances without rating', async () => {
    await reviewSession.start('test-deck');
    reviewSession.skip();
    const state = reviewSession.getState()!;
    expect(state.currentIndex).toBe(1);
    expect(state.done).toBe(0);
  });

  it('end clears the session', async () => {
    await reviewSession.start('test-deck');
    reviewSession.end();
    expect(reviewSession.isActive()).toBe(false);
    expect(reviewSession.getState()).toBeNull();
  });

  it('generates reverse cards for reversible entries', async () => {
    await reviewSession.start('test-deck');
    const state = reviewSession.getState()!;
    const reverseCard = state.cards.find(c => c.id === 'gato:reverse');
    expect(reverseCard).toBeDefined();
    expect(reverseCard!.source).toBe('cat');
    expect(reverseCard!.translation).toBe('gato');
    expect(reverseCard!.isReverse).toBe(true);
  });

  it('respects new card daily limit', async () => {
    localStorage.setItem(
      'flash-card-settings',
      JSON.stringify({ repoUrl: 'x', token: 'x', newCardsPerDay: 2, reviewOrder: 'random', theme: 'system' }),
    );

    await reviewSession.start('test-deck');
    const state = reviewSession.getState()!;
    // All cards are new in the mock (reps: 0), so total should be limited to newCardsPerDay
    expect(state.total).toBeLessThanOrEqual(2);
  });
});
