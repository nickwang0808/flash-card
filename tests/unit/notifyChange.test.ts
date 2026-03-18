import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase client — auth.getUser returns null by default (not configured)
const mockGetUser = vi.fn(() => Promise.resolve({ data: { user: null }, error: null }));
const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: vi.fn(() => ({
      upsert: mockUpsert,
      select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ data: [], error: null })) })) })),
    })),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

vi.mock('../../src/services/rxdb', () => ({
  getDatabaseSync: vi.fn(() => ({
    reviewlogs: {
      findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
      find: vi.fn(() => ({ remove: vi.fn(() => Promise.resolve()) })),
      bulkInsert: vi.fn(() => Promise.resolve()),
    },
    settings: {
      findOne: vi.fn(() => ({ exec: vi.fn(() => Promise.resolve(null)) })),
      upsert: vi.fn(() => Promise.resolve()),
    },
  })),
}));

const mockGetCardDataByIds = vi.fn(() => Promise.resolve([]));
vi.mock('../../src/services/card-repository', () => ({
  getCardRepository: vi.fn(() => ({
    getCardDataByIds: mockGetCardDataByIds,
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
  notifyChange, flushSync, cancelSync,
} from '../../src/services/replication';

describe('notifyChange debounce', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await cancelSync();
    mockGetUser.mockClear();
    mockUpsert.mockClear();
    mockGetCardDataByIds.mockClear();
    // Default: not configured (null user) so pushDirtyCards exits early
    mockGetUser.mockImplementation(() => Promise.resolve({ data: { user: null }, error: null }));
    mockGetCardDataByIds.mockImplementation(() => Promise.resolve([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // pushDirtyCards calls isConfigured → supabase.auth.getUser. We use its call count
  // as evidence that the push was triggered.
  function pushCallCount() {
    return mockGetUser.mock.calls.length;
  }

  it('debounce resets on each call, fires once after idle', async () => {
    notifyChange('card-1');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushCallCount()).toBe(0);

    notifyChange('card-1'); // reset timer (same card, deduped in Set)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushCallCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000); // 10s after second call — fires
    expect(pushCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('max batch (10 changes) triggers immediate flush', async () => {
    for (let i = 0; i < 9; i++) {
      notifyChange(`card-${i}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(0);

    notifyChange('card-9'); // 10th unique card — immediate flush
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('dirty set resets after flush', async () => {
    for (let i = 0; i < 10; i++) {
      notifyChange(`card-${i}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBeGreaterThanOrEqual(1);

    mockGetUser.mockClear();

    for (let i = 10; i < 20; i++) {
      notifyChange(`card-${i}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('flushSync triggers push when dirty cards exist', async () => {
    notifyChange('card-1');
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('flushSync is a no-op when no dirty cards', async () => {
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(0);
  });

  it('cancelSync cleans up timer and dirty set', async () => {
    notifyChange('card-1');
    await cancelSync();
    mockGetUser.mockClear();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(pushCallCount()).toBe(0);
  });
});
