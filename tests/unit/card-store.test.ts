import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockGitService } from '../mocks/git-service.mock';
import { testCardsJson } from '../fixtures/cards';
import { testStateJson } from '../fixtures/state';

vi.mock('../../src/services/git-service', () => ({
  gitService: mockGitService,
}));

import { cardStore } from '../../src/services/card-store';

describe('CardStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGitService._clearFiles();
    localStorage.clear();
  });

  it('loads a deck with cards and state', async () => {
    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService._setFile('test-deck/state.json', testStateJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);

    await cardStore.loadAllDecks();
    expect(cardStore.getDeckNames()).toEqual(['test-deck']);
  });

  it('creates new state for cards without existing state', async () => {
    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);

    await cardStore.loadAllDecks();
    // 'perro' has no state in testState, should be new
    const state = cardStore.getState('test-deck', 'perro');
    expect(state.reps).toBe(0);
  });

  it('generates reverse cards for reversible entries', async () => {
    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);

    await cardStore.loadAllDecks();
    const cards = cardStore.getReviewableCards('test-deck');
    const reverseCard = cards.find((c) => c.id === 'gato:reverse');
    expect(reverseCard).toBeDefined();
    expect(reverseCard!.source).toBe('cat'); // translation becomes source
    expect(reverseCard!.translation).toBe('gato'); // source becomes translation
    expect(reverseCard!.isReverse).toBe(true);
  });

  it('returns due cards correctly', async () => {
    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService._setFile('test-deck/state.json', testStateJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);

    await cardStore.loadAllDecks();
    const due = cardStore.getDueCards('test-deck');
    // 'hola' is due 2025-02-01 so should be due if "now" is after that
    const holaCard = due.find((c) => c.id === 'hola');
    expect(holaCard).toBeDefined();
  });

  it('returns new cards correctly', async () => {
    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService._setFile('test-deck/state.json', testStateJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);

    await cardStore.loadAllDecks();
    const newCards = cardStore.getNewCards('test-deck');
    // perro, casa, agua have no state -> new
    expect(newCards.length).toBeGreaterThanOrEqual(3);
  });

  it('reviews a card and updates state', async () => {
    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService._setFile('test-deck/state.json', testStateJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);

    await cardStore.loadAllDecks();
    const { Rating } = await import('../../src/utils/fsrs');
    const updated = cardStore.review('test-deck', 'hola', Rating.Good);
    expect(updated.reps).toBeGreaterThan(0);
  });

  it('saves state to git and clears WAL', async () => {
    mockGitService._setFile('test-deck/cards.json', testCardsJson);
    mockGitService._setFile('test-deck/state.json', testStateJson);
    mockGitService.listDirectories.mockResolvedValue(['test-deck']);

    await cardStore.loadAllDecks();
    const { Rating } = await import('../../src/utils/fsrs');
    cardStore.review('test-deck', 'hola', Rating.Good);
    expect(cardStore.hasWALEntries()).toBe(true);

    await cardStore.save('test-deck');
    expect(mockGitService.writeFile).toHaveBeenCalled();
    expect(cardStore.hasWALEntries()).toBe(false);
  });
});
