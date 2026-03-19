import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase client
const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    from: vi.fn(() => ({
      upsert: mockUpsert,
      select: vi.fn(() => {
        const chain: any = {};
        chain.eq = vi.fn(() => chain);
        chain.limit = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
        return chain;
      }),
    })),
  },
}));

vi.mock('../../src/services/rxdb', () => ({
  getDatabaseSync: vi.fn(() => ({
    reviewlogs: {
      findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
    },
  })),
}));

const mockGetCardDataByIds = vi.fn(() => Promise.resolve([]));
const mockPushCards = vi.fn(() => Promise.resolve());
const mockPushReviewLogs = vi.fn(() => Promise.resolve());

vi.mock('../../src/services/card-repository', () => ({
  getCardRepository: vi.fn(() => ({
    getCardDataByIds: mockGetCardDataByIds,
  })),
}));

vi.mock('../../src/services/supabase-storage', () => ({
  SupabaseStorageService: vi.fn().mockImplementation(() => ({
    pushCards: mockPushCards,
    pushReviewLogs: mockPushReviewLogs,
  })),
}));

vi.mock('../../src/hooks/useSettings', () => ({
  defaultSettings: {
    id: 'settings',
    newCardsPerDay: 10,
    reviewOrder: 'random',
    theme: 'system',
  },
}));

import {
  notifyChange, cancelSync,
} from '../../src/services/replication';

describe('notifyChange immediate push', () => {
  beforeEach(async () => {
    await cancelSync();
    mockGetCardDataByIds.mockClear();
    mockPushCards.mockClear();
    mockPushReviewLogs.mockClear();
  });

  it('pushes card immediately on notifyChange', async () => {
    mockGetCardDataByIds.mockImplementation((async () => [
      { deckName: 'deck', term: 'hello', back: 'hi', tags: [], created: '2025-01-01', reversible: false, order: 0, state: null, reverseState: null },
    ]) as any);

    notifyChange('deck|hello');

    // Wait for the fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(mockGetCardDataByIds).toHaveBeenCalledWith(['deck|hello']);
    expect(mockPushCards).toHaveBeenCalledTimes(1);
  });

  it('does not push when offline', async () => {
    const original = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    notifyChange('deck|hello');
    await new Promise((r) => setTimeout(r, 50));

    expect(mockGetCardDataByIds).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { value: original, writable: true });
  });

  it('does not push when card not found', async () => {
    mockGetCardDataByIds.mockImplementation(async () => []);

    notifyChange('deck|missing');
    await new Promise((r) => setTimeout(r, 50));

    expect(mockPushCards).not.toHaveBeenCalled();
  });
});
