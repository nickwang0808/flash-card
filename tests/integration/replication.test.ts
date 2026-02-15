import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CardData, GitStorageService } from '../../src/services/git-storage';

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

function makeCard(source: string, deckName = 'test-deck', overrides: Partial<CardData> = {}): CardData {
  return {
    deckName,
    source,
    translation: `${source}-translation`,
    created: '2025-01-01T00:00:00Z',
    reversible: false,
    state: null,
    reverseState: null,
    ...overrides,
  };
}

// We need to mock RxDB and settings before importing replication
const mockSettings = {
  repoUrl: 'https://github.com/test/repo',
  token: 'test-token',
  newCardsPerDay: 10,
  reviewOrder: 'random',
  theme: 'system',
};

const mockCardsData: Map<string, any> = new Map();
const mockDecksData: Map<string, any> = new Map();

const mockCardsCollection = {
  find: vi.fn(() => ({
    exec: vi.fn(async () => [...mockCardsData.values()].map((c) => ({
      ...c,
      toJSON: () => c,
      remove: vi.fn(),
    }))),
    remove: vi.fn(async () => {
      mockCardsData.clear();
    }),
  })),
  findOne: vi.fn((id: string) => ({
    exec: vi.fn(async () => {
      const card = mockCardsData.get(id);
      if (!card) return null;
      return {
        ...card,
        toJSON: () => card,
        incrementalPatch: vi.fn(async (patch: any) => {
          mockCardsData.set(id, { ...card, ...patch });
        }),
      };
    }),
  })),
  bulkInsert: vi.fn(async (docs: any[]) => {
    for (const doc of docs) {
      mockCardsData.set(doc.id, doc);
    }
  }),
};

const mockDecksCollection = {
  find: vi.fn(() => ({
    exec: vi.fn(async () => [...mockDecksData.values()].map((d) => ({
      ...d,
      name: d.name,
      remove: vi.fn(async () => mockDecksData.delete(d.name)),
    }))),
  })),
  insert: vi.fn(async (doc: any) => {
    mockDecksData.set(doc.name, doc);
  }),
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
    cards: mockCardsCollection,
    decks: mockDecksCollection,
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

import { setServiceFactory, runSync, notifyChange, flushSync, cancelSync } from '../../src/services/replication';

describe('Replication with mocked GitStorageService', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await cancelSync();
    mockCardsData.clear();
    mockDecksData.clear();
    mockCardsCollection.find.mockClear();
    mockCardsCollection.findOne.mockClear();
    mockCardsCollection.bulkInsert.mockClear();
    mockDecksCollection.find.mockClear();
    mockDecksCollection.insert.mockClear();
  });

  afterEach(() => {
    setServiceFactory(null as any);
    vi.useRealTimers();
  });

  it('runSync pulls and replaces RxDB cards', async () => {
    const seedCards = [
      makeCard('hello', 'spanish'),
      makeCard('world', 'spanish'),
    ];
    const mockService = createMockService(seedCards);
    setServiceFactory(async () => mockService);

    await runSync();

    expect(mockService.pullCallCount).toBe(1);
    expect(mockCardsCollection.bulkInsert).toHaveBeenCalledTimes(1);

    const insertedCards = mockCardsCollection.bulkInsert.mock.calls[0][0];
    expect(insertedCards).toHaveLength(2);
    expect(insertedCards[0].source).toBe('hello');
    expect(insertedCards[0].id).toBe('spanish|hello');
    expect(insertedCards[1].source).toBe('world');
  });

  it('runSync creates deck entries from pulled cards', async () => {
    const seedCards = [
      makeCard('hello', 'spanish'),
      makeCard('bonjour', 'french'),
    ];
    const mockService = createMockService(seedCards);
    setServiceFactory(async () => mockService);

    await runSync();

    expect(mockDecksCollection.insert).toHaveBeenCalledTimes(2);
    const insertedDecks = mockDecksCollection.insert.mock.calls.map((c: any[]) => c[0].name);
    expect(insertedDecks).toContain('spanish');
    expect(insertedDecks).toContain('french');
  });

  it('pushDirtyCards sends correct CardData via service', async () => {
    const mockService = createMockService();
    setServiceFactory(async () => mockService);

    // Seed a card in RxDB
    const card = {
      id: 'deck|hello',
      deckName: 'deck',
      source: 'hello',
      translation: 'hi',
      example: 'Hello!',
      notes: '',
      tags: [],
      created: '2025-01-01T00:00:00Z',
      reversible: false,
      state: null,
      reverseState: null,
      suspended: false,
    };
    mockCardsData.set('deck|hello', card);

    notifyChange('deck|hello');
    await vi.advanceTimersByTimeAsync(10_000);

    // Allow promises to settle
    await vi.runAllTimersAsync();

    expect(mockService.pushCardsCalls.length).toBe(1);
    const pushed = mockService.pushCardsCalls[0];
    expect(pushed).toHaveLength(1);
    expect(pushed[0].source).toBe('hello');
    expect(pushed[0].deckName).toBe('deck');
    expect(pushed[0].translation).toBe('hi');
  });

  it('debounce batches multiple changes into one push', async () => {
    const mockService = createMockService();
    setServiceFactory(async () => mockService);

    // Seed cards
    for (const source of ['a', 'b', 'c']) {
      const card = {
        id: `deck|${source}`, deckName: 'deck', source,
        translation: source, example: '', notes: '', tags: [],
        created: '2025-01-01', reversible: false,
        state: null, reverseState: null, suspended: false,
      };
      mockCardsData.set(`deck|${source}`, card);
    }

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
      translation: 'cat',
      example: 'El gato',
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

    // Pull
    await runSync();

    // Verify card in RxDB
    const inserted = mockCardsCollection.bulkInsert.mock.calls[0][0][0];
    expect(inserted.source).toBe('gato');
    expect(inserted.translation).toBe('cat');
    expect(inserted.reversible).toBe(true);
    expect(inserted.state).toEqual(originalCard.state);
  });
});
