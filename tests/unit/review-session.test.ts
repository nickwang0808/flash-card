import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockGithubApi } from '../mocks/github-api.mock';
import { testCardsJson } from '../fixtures/cards';
import { testStateJson } from '../fixtures/state';

vi.mock('../../src/services/github-api', () => ({
  githubApi: mockGithubApi,
  parseRepoUrl: () => ({ owner: 'test', repo: 'repo' }),
}));

import { cardStore } from '../../src/services/card-store';
import { reviewSession } from '../../src/services/review-session';
import { Rating } from '../../src/utils/fsrs';

describe('ReviewSession', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGithubApi._clearFiles();
    localStorage.clear();

    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi._setFile('test-deck/state.json', testStateJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);
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

  it('rating advances to next card and queues review', async () => {
    reviewSession.start('test-deck');
    reviewSession.showAnswer();
    await reviewSession.rate(Rating.Good);

    const secondCard = reviewSession.getCurrentCard();
    if (secondCard) {
      expect(reviewSession.getState()!.done).toBe(1);
    }
    // Should have queued a pending review
    expect(cardStore.hasPendingReviews()).toBe(true);
  });

  it('skip advances without rating', () => {
    reviewSession.start('test-deck');
    reviewSession.skip();
    const state = reviewSession.getState()!;
    expect(state.currentIndex).toBe(1);
    expect(state.done).toBe(0);
  });

  it('respects new card daily limit', () => {
    localStorage.setItem(
      'flash-card-settings',
      JSON.stringify({ repoUrl: 'x', token: 'x', newCardsPerDay: 2, reviewOrder: 'random', theme: 'system' }),
    );

    reviewSession.start('test-deck');
    const state = reviewSession.getState()!;
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
