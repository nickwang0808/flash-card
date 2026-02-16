import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CardData, GitStorageService } from '../../src/services/git-storage';
import type { CardRepository } from '../../src/services/card-repository';

// Create a mock service that records calls
function createMockService(initialCards: CardData[] = []): GitStorageService & {
  pushCardsCalls: CardData[][];
  pullCallCount: number;
} {
  const mock = {
    pushCardsCalls: [] as CardData[][],
    pullCallCount: 0,

    async pullAllCards(): Promise<CardData[]> {
      mock.pullCallCount++;
      return initialCards;
    },

    async pushCards(cards: CardData[]): Promise<void> {
      mock.pushCardsCalls.push([...cards]);
    },

    async getCommits(_limit?: number) {
      return [{ message: 'test commit', sha: 'abc1234', date: '2025-01-01T00:00:00Z' }];
    },

    async validateConnection() {
      return true;
    },

    async listDecks() {
      return [...new Set(initialCards.map((c) => c.deckName))];
    },
  };
  return mock;
}

let nextOrder = 0;
function makeCard(term: string, deckName = 'test-deck', overrides: Partial<CardData> = {}): CardData {
  return {
    deckName,
    term,
    back: `${term}-translation`,
    created: '2025-01-01T00:00:00Z',
    reversible: false,
    order: nextOrder++,
    state: null,
    reverseState: null,
    ...overrides,
  };
}

// Mock CardRepository
const mockCardsStore: Map<string, CardData & { id: string }> = new Map();

const mockCardRepository: CardRepository = {
  getById: vi.fn(async (id: string) => {
    const card = mockCardsStore.get(id);
    return card ? { ...card, state: null, reverseState: null } as any : null;
  }),
  getAll: vi.fn(async () => [...mockCardsStore.values()] as any[]),
  getDeckNames: vi.fn(async () => [...new Set([...mockCardsStore.values()].map(c => c.deckName))]),
  updateState: vi.fn(async () => {}),
  suspend: vi.fn(async () => {}),
  replaceAll: vi.fn(async (cards: CardData[]) => {
    mockCardsStore.clear();
    for (const c of cards) {
      const id = `${c.deckName}|${c.term}`;
      mockCardsStore.set(id, { ...c, id });
    }
  }),
  getCardDataByIds: vi.fn(async (ids: string[]) => {
    const result: CardData[] = [];
    for (const id of ids) {
      const card = mockCardsStore.get(id);
      if (card) {
        const { id: _id, ...data } = card;
        result.push(data);
      }
    }
    return result;
  }),
};

vi.mock('../../src/services/card-repository', () => ({
  getCardRepository: vi.fn(() => mockCardRepository),
  makeCardId: (deckName: string, term: string) => `${deckName}|${term}`,
}));

// We need to mock RxDB for settings access only
const mockSettings = {
  repoUrl: 'https://github.com/test/repo',
  token: 'test-token',
  newCardsPerDay: 10,
  reviewOrder: 'random',
  theme: 'system',
};

vi.mock('../../src/services/rxdb', () => ({
  getDatabaseSync: vi.fn(() => ({
    settings: {
      findOne: vi.fn(() => ({
        exec: vi.fn(async () => ({
          toJSON: () => mockSettings,
        })),
      })),
    },
  })),
}));

vi.mock('../../src/hooks/useSettings', () => ({
  defaultSettings: {
    repoUrl: '',
    token: '',
    newCardsPerDay: 10,
    reviewOrder: 'random',
    theme: 'system',
  },
}));

// Mock navigator.onLine
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  writable: true,
});

import { setServiceFactory, runSync, notifyChange, cancelSync } from '../../src/services/replication';

describe('Replication with mocked GitStorageService', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await cancelSync();
    mockCardsStore.clear();
    vi.mocked(mockCardRepository.replaceAll).mockClear();
    vi.mocked(mockCardRepository.getCardDataByIds).mockClear();
  });

  afterEach(() => {
    setServiceFactory(null as any);
    vi.useRealTimers();
  });

  it('runSync pulls and replaces cards via repository', async () => {
    const seedCards = [
      makeCard('hello', 'spanish'),
      makeCard('world', 'spanish'),
    ];
    const mockService = createMockService(seedCards);
    setServiceFactory(async () => mockService);

    await runSync();

    expect(mockService.pullCallCount).toBe(1);
    expect(mockCardRepository.replaceAll).toHaveBeenCalledTimes(1);

    const replacedCards = vi.mocked(mockCardRepository.replaceAll).mock.calls[0][0];
    expect(replacedCards).toHaveLength(2);
    expect(replacedCards[0].term).toBe('hello');
    expect(replacedCards[1].term).toBe('world');
  });

  it('runSync populates card store after pull', async () => {
    const seedCards = [
      makeCard('hello', 'spanish'),
      makeCard('bonjour', 'french'),
    ];
    const mockService = createMockService(seedCards);
    setServiceFactory(async () => mockService);

    // Allow replaceAll to actually populate the store
    vi.mocked(mockCardRepository.replaceAll).mockImplementation(async (cards) => {
      mockCardsStore.clear();
      for (const c of cards) {
        const id = `${c.deckName}|${c.term}`;
        mockCardsStore.set(id, { ...c, id });
      }
    });

    await runSync();

    expect(mockCardsStore.size).toBe(2);
    expect(mockCardsStore.has('spanish|hello')).toBe(true);
    expect(mockCardsStore.has('french|bonjour')).toBe(true);
  });

  it('pushDirtyCards sends correct CardData via service', async () => {
    const mockService = createMockService();
    setServiceFactory(async () => mockService);

    // Seed a card in the store
    const card = {
      id: 'deck|hello',
      deckName: 'deck',
      term: 'hello',
      back: 'hi',
      tags: [] as string[],
      created: '2025-01-01T00:00:00Z',
      reversible: false,
      order: 0,
      state: null,
      reverseState: null,
      suspended: false,
    };
    mockCardsStore.set('deck|hello', card);

    // Re-mock getCardDataByIds to actually use the store
    vi.mocked(mockCardRepository.getCardDataByIds).mockImplementation(async (ids) => {
      const result: CardData[] = [];
      for (const id of ids) {
        const c = mockCardsStore.get(id);
        if (c) {
          const { id: _id, ...data } = c;
          result.push(data);
        }
      }
      return result;
    });

    notifyChange('deck|hello');
    await vi.advanceTimersByTimeAsync(10_000);

    // Allow promises to settle
    await vi.runAllTimersAsync();

    expect(mockService.pushCardsCalls.length).toBe(1);
    const pushed = mockService.pushCardsCalls[0];
    expect(pushed).toHaveLength(1);
    expect(pushed[0].term).toBe('hello');
    expect(pushed[0].deckName).toBe('deck');
    expect(pushed[0].back).toBe('hi');
  });

  it('debounce batches multiple changes into one push', async () => {
    const mockService = createMockService();
    setServiceFactory(async () => mockService);

    // Seed cards
    for (const [i, term] of ['a', 'b', 'c'].entries()) {
      const card = {
        id: `deck|${term}`, deckName: 'deck', term,
        back: term, tags: [] as string[],
        created: '2025-01-01', reversible: false, order: i,
        state: null, reverseState: null, suspended: false,
      };
      mockCardsStore.set(`deck|${term}`, card);
    }

    vi.mocked(mockCardRepository.getCardDataByIds).mockImplementation(async (ids) => {
      const result: CardData[] = [];
      for (const id of ids) {
        const c = mockCardsStore.get(id);
        if (c) {
          const { id: _id, ...data } = c;
          result.push(data);
        }
      }
      return result;
    });

    notifyChange('deck|a');
    notifyChange('deck|b');
    notifyChange('deck|c');

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.runAllTimersAsync();

    // Should be 1 pushCards call with all 3 cards
    expect(mockService.pushCardsCalls.length).toBe(1);
    expect(mockService.pushCardsCalls[0]).toHaveLength(3);
  });

  it('round-trip: push cards then pull same data back', async () => {
    const originalCard = makeCard('gato', 'spanish', {
      back: 'cat\n\n*El gato*',
      reversible: true,
      tags: ['animal'],
      state: { due: '2025-02-01T00:00:00Z', stability: 1.5, difficulty: 5, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, state: 2 },
      reverseState: null,
    });

    // Mock service that remembers pushed cards and returns them on pull
    let storedCards: CardData[] = [originalCard];
    const service: GitStorageService = {
      async pullAllCards() { return storedCards; },
      async pushCards(cards) { storedCards = cards; },
      async getCommits() { return []; },
      async validateConnection() { return true; },
      async listDecks() { return ['spanish']; },
    };
    setServiceFactory(async () => service);

    // Track what gets passed to replaceAll
    let replacedCards: CardData[] = [];
    vi.mocked(mockCardRepository.replaceAll).mockImplementation(async (cards) => {
      replacedCards = cards;
      mockCardsStore.clear();
      for (const c of cards) {
        const id = `${c.deckName}|${c.term}`;
        mockCardsStore.set(id, { ...c, id });
      }
    });

    // Pull
    await runSync();

    // Verify card passed to repository
    expect(replacedCards).toHaveLength(1);
    expect(replacedCards[0].term).toBe('gato');
    expect(replacedCards[0].back).toBe('cat\n\n*El gato*');
    expect(replacedCards[0].reversible).toBe(true);
    expect(replacedCards[0].state).toEqual(originalCard.state);
  });
});
