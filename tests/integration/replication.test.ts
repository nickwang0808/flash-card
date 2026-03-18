import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CardData } from '../../src/services/git-storage';
import type { CardRepository } from '../../src/services/card-repository';
import { SupabaseStorageService } from '../../src/services/supabase-storage';

// Mock Supabase client with authenticated user
const mockGetUser = vi.fn(() => Promise.resolve({
  data: { user: { id: 'test-user-id' } },
  error: null,
}));

// Track upsert/select calls per table
const mockTableData: Record<string, any[]> = {
  cards: [],
  srs_state: [],
  review_logs: [],
  settings: [],
};

const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
const mockBulkInsert = vi.fn(() => Promise.resolve());

vi.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: vi.fn((table: string) => ({
      upsert: mockUpsert,
      select: vi.fn(() => {
        const chain: any = {};
        chain.eq = vi.fn(() => chain);
        chain.limit = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
        chain.then = vi.fn((resolve: any) => resolve({ data: mockTableData[table] ?? [], error: null }));
        return chain;
      }),
    })),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

vi.mock('../../src/services/rxdb', () => ({
  getDatabaseSync: vi.fn(() => ({
    reviewlogs: {
      findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
      find: vi.fn(() => ({
        remove: vi.fn(() => Promise.resolve()),
        $: { subscribe: vi.fn() },
      })),
      bulkInsert: mockBulkInsert,
    },
    settings: {
      findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
      upsert: vi.fn(() => Promise.resolve()),
    },
  })),
}));

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

vi.mock('../../src/hooks/useSettings', () => ({
  defaultSettings: {
    id: 'settings',
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

import { setStorageService, runSync, notifyChange, cancelSync } from '../../src/services/replication';

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

describe('Replication with SupabaseStorageService', () => {
  let mockStorage: SupabaseStorageService;
  let storedCards: CardData[];

  beforeEach(async () => {
    vi.useFakeTimers();
    await cancelSync();
    mockCardsStore.clear();
    vi.mocked(mockCardRepository.replaceAll).mockClear();
    vi.mocked(mockCardRepository.getCardDataByIds).mockClear();
    mockUpsert.mockClear();
    storedCards = [];

    // Create a mock storage service
    mockStorage = {
      pullAllCards: vi.fn(async () => storedCards),
      pushCards: vi.fn(async (cards: CardData[]) => { storedCards = cards; }),
      pushReviewLogs: vi.fn(async () => {}),
      pushSettings: vi.fn(async () => {}),
      pullSettings: vi.fn(async () => null),
      pullReviewLogs: vi.fn(async () => []),
    } as any;

    setStorageService(mockStorage);
  });

  afterEach(() => {
    setStorageService(null);
    vi.useRealTimers();
  });

  it('runSync pulls and replaces cards via repository', async () => {
    storedCards = [
      makeCard('hello', 'spanish'),
      makeCard('world', 'spanish'),
    ];

    await runSync();

    expect(mockStorage.pullAllCards).toHaveBeenCalledTimes(1);
    expect(mockCardRepository.replaceAll).toHaveBeenCalledTimes(1);

    const replacedCards = vi.mocked(mockCardRepository.replaceAll).mock.calls[0][0];
    expect(replacedCards).toHaveLength(2);
    expect(replacedCards[0].term).toBe('hello');
    expect(replacedCards[1].term).toBe('world');
  });

  it('runSync populates card store after pull', async () => {
    storedCards = [
      makeCard('hello', 'spanish'),
      makeCard('bonjour', 'french'),
    ];

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
    await vi.runAllTimersAsync();

    expect(mockStorage.pushCards).toHaveBeenCalledTimes(1);
    const pushed = vi.mocked(mockStorage.pushCards).mock.calls[0][0];
    expect(pushed).toHaveLength(1);
    expect(pushed[0].term).toBe('hello');
    expect(pushed[0].deckName).toBe('deck');
    expect(pushed[0].back).toBe('hi');
  });

  it('debounce batches multiple changes into one push', async () => {
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

    expect(mockStorage.pushCards).toHaveBeenCalledTimes(1);
    const pushed = vi.mocked(mockStorage.pushCards).mock.calls[0][0];
    expect(pushed).toHaveLength(3);
  });

  it('round-trip: push cards then pull same data back', async () => {
    const originalCard = makeCard('gato', 'spanish', {
      back: 'cat\n\n*El gato*',
      reversible: true,
      tags: ['animal'],
      state: { due: '2025-02-01T00:00:00Z', stability: 1.5, difficulty: 5, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, state: 2 },
      reverseState: null,
    });

    storedCards = [originalCard];

    let replacedCards: CardData[] = [];
    vi.mocked(mockCardRepository.replaceAll).mockImplementation(async (cards) => {
      replacedCards = cards;
      mockCardsStore.clear();
      for (const c of cards) {
        const id = `${c.deckName}|${c.term}`;
        mockCardsStore.set(id, { ...c, id });
      }
    });

    await runSync();

    expect(replacedCards).toHaveLength(1);
    expect(replacedCards[0].term).toBe('gato');
    expect(replacedCards[0].back).toBe('cat\n\n*El gato*');
    expect(replacedCards[0].reversible).toBe(true);
    expect(replacedCards[0].state).toEqual(originalCard.state);
  });
});
