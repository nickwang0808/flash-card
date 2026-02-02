import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockGitService } from '../mocks/git-service.mock';
import { testCardsJson } from '../fixtures/cards';
import { testStateJson } from '../fixtures/state';

vi.mock('../../src/services/git-service', () => ({
  gitService: mockGitService,
}));

import { cardStore } from '../../src/services/card-store';
import { reviewSession } from '../../src/services/review-session';
import { Rating } from '../../src/utils/fsrs';

describe('ReviewSession', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGitService._clearFiles();
    localStorage.clear();

    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService._setFile('test-deck/state.json', testStateJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);
    await cardStore.loadAllDecks();
  });

  it('starts a session with cards', () => {
    reviewSession.start('test-deck');
    expect(reviewSession.isActive()).toBe(true);
    const state = reviewSession.getState();
    expect(state).not.toBeNull();
    expect(state!.total).toBeGreaterThan(0);
  });

  it('getCurrentCard returns a card', () => {
    reviewSession.start('test-deck');
    const card = reviewSession.getCurrentCard();
    expect(card).not.toBeNull();
    expect(card!.source).toBeDefined();
  });

  it('showAnswer reveals the answer', () => {
    reviewSession.start('test-deck');
    expect(reviewSession.getState()!.answerRevealed).toBe(false);
    reviewSession.showAnswer();
    expect(reviewSession.getState()!.answerRevealed).toBe(true);
  });

  it('rating advances to next card', async () => {
    reviewSession.start('test-deck');
    const firstCard = reviewSession.getCurrentCard();
    reviewSession.showAnswer();
    await reviewSession.rate(Rating.Good);

    const secondCard = reviewSession.getCurrentCard();
    // Either moved to next card or session ended
    if (secondCard) {
      expect(reviewSession.getState()!.done).toBe(1);
    }
  });

  it('skip advances without rating', () => {
    reviewSession.start('test-deck');
    reviewSession.skip();
    const state = reviewSession.getState()!;
    expect(state.currentIndex).toBe(1);
    expect(state.done).toBe(0); // skip doesn't count as done
  });

  it('respects new card daily limit', () => {
    // Set limit to 2
    localStorage.setItem(
      'flash-card-settings',
      JSON.stringify({ repoUrl: 'x', token: 'x', newCardsPerDay: 2, reviewOrder: 'random', theme: 'system' }),
    );

    reviewSession.start('test-deck');
    const state = reviewSession.getState()!;
    // Should have at most 2 new cards + due cards
    const newCards = state.cards.filter((c) => {
      const s = cardStore.getState('test-deck', c.id);
      return s.reps === 0;
    });
    expect(newCards.length).toBeLessThanOrEqual(2);
  });

  it('end clears the session', () => {
    reviewSession.start('test-deck');
    reviewSession.end();
    expect(reviewSession.isActive()).toBe(false);
    expect(reviewSession.getState()).toBeNull();
  });
});
