import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockGithubApi } from '../mocks/github-api.mock';
import { testCardsJson } from '../fixtures/cards';
import { testStateJson } from '../fixtures/state';

vi.mock('../../src/services/github-api', () => ({
  githubApi: mockGithubApi,
  parseRepoUrl: () => ({ owner: 'test', repo: 'repo' }),
}));

import { cardStore } from '../../src/services/card-store';

describe('CardStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGithubApi._clearFiles();
    localStorage.clear();
  });

  it('loads a deck with cards and state', async () => {
    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi._setFile('test-deck/state.json', testStateJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);

    await cardStore.loadAllDecks();
    expect(cardStore.getDeckNames()).toEqual(['test-deck']);
  });

  it('creates new state for cards without existing state', async () => {
    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);

    await cardStore.loadAllDecks();
    const state = cardStore.getState('test-deck', 'perro');
    expect(state.reps).toBe(0);
  });

  it('generates reverse cards for reversible entries', async () => {
    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);

    await cardStore.loadAllDecks();
    const cards = cardStore.getReviewableCards('test-deck');
    const reverseCard = cards.find((c) => c.id === 'gato:reverse');
    expect(reverseCard).toBeDefined();
    expect(reverseCard!.source).toBe('cat');
    expect(reverseCard!.translation).toBe('gato');
    expect(reverseCard!.isReverse).toBe(true);
  });

  it('returns due cards correctly', async () => {
    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi._setFile('test-deck/state.json', testStateJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);

    await cardStore.loadAllDecks();
    const due = cardStore.getDueCards('test-deck');
    const holaCard = due.find((c) => c.id === 'hola');
    expect(holaCard).toBeDefined();
  });

  it('returns new cards correctly', async () => {
    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi._setFile('test-deck/state.json', testStateJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);

    await cardStore.loadAllDecks();
    const newCards = cardStore.getNewCards('test-deck');
    expect(newCards.length).toBeGreaterThanOrEqual(3);
  });

  it('reviews a card and updates state', async () => {
    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi._setFile('test-deck/state.json', testStateJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);

    await cardStore.loadAllDecks();
    const { Rating } = await import('../../src/utils/fsrs');
    const updated = cardStore.review('test-deck', 'hola', Rating.Good);
    expect(updated.reps).toBeGreaterThan(0);
  });

  it('queues pending reviews on review', async () => {
    mockGithubApi._setFile('test-deck/cards.json', testCardsJson);
    mockGithubApi._setFile('test-deck/state.json', testStateJson);
    mockGithubApi.listDirectory.mockResolvedValue([{ name: 'test-deck', type: 'dir' }]);

    await cardStore.loadAllDecks();
    const { Rating } = await import('../../src/utils/fsrs');
    cardStore.review('test-deck', 'hola', Rating.Good);
    expect(cardStore.hasPendingReviews()).toBe(true);
    expect(cardStore.getPendingCount()).toBe(1);
  });
});
