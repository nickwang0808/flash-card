import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFindOneExec = vi.fn(() => Promise.resolve(null));
const mockCardFindOneExec = vi.fn(() => Promise.resolve(null));
vi.mock('../../src/services/rxdb', () => ({
  getDatabaseSync: vi.fn(() => ({
    settings: { findOne: vi.fn(() => ({ exec: mockFindOneExec })) },
    cards: { findOne: vi.fn(() => ({ exec: mockCardFindOneExec })) },
  })),
}));

const mockPushCards = vi.fn(() => Promise.resolve());
const mockPullAllCards = vi.fn(() => Promise.resolve([]));
vi.mock('../../src/services/github', () => ({
  GitHubStorageService: vi.fn().mockImplementation(() => ({
    pushCards: mockPushCards,
    pullAllCards: mockPullAllCards,
  })),
  parseRepoUrl: vi.fn(() => ({ owner: 'test', repo: 'test' })),
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

import {
  notifyChange, flushSync, cancelSync,
} from '../../src/services/replication';
import { getDatabaseSync } from '../../src/services/rxdb';

describe('notifyChange debounce', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await cancelSync();
    vi.mocked(getDatabaseSync).mockClear();
    mockPushCards.mockClear();
    mockFindOneExec.mockClear();
    // Default: not configured (empty repoUrl/token) so pushDirtyCards exits early
    mockFindOneExec.mockImplementation(() => Promise.resolve(null));
    mockCardFindOneExec.mockImplementation(() => Promise.resolve(null));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // pushDirtyCards calls isConfigured → getDatabaseSync. We use its call count
  // as evidence that the push was triggered.
  function pushCallCount() {
    return vi.mocked(getDatabaseSync).mock.calls.length;
  }

  it('debounce resets on each call, fires once after idle', async () => {
    notifyChange('card-1');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushCallCount()).toBe(0);

    notifyChange('card-1'); // reset timer (same card, deduped in Set)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushCallCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000); // 10s after second call — fires
    expect(pushCallCount()).toBe(1);
  });

  it('max batch (10 changes) triggers immediate flush', async () => {
    for (let i = 0; i < 9; i++) {
      notifyChange(`card-${i}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(0);

    notifyChange('card-9'); // 10th unique card — immediate flush
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(1);
  });

  it('dirty set resets after flush', async () => {
    for (let i = 0; i < 10; i++) {
      notifyChange(`card-${i}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(1);

    vi.mocked(getDatabaseSync).mockClear();

    for (let i = 10; i < 20; i++) {
      notifyChange(`card-${i}`);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(1);
  });

  it('flushSync triggers push when dirty cards exist', async () => {
    notifyChange('card-1');
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(1);
  });

  it('flushSync is a no-op when no dirty cards', async () => {
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushCallCount()).toBe(0);
  });

  it('cancelSync cleans up timer and dirty set', async () => {
    notifyChange('card-1');
    await cancelSync();
    vi.mocked(getDatabaseSync).mockClear();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(pushCallCount()).toBe(0);
  });

  it('deduplicates repeated changes to the same card', async () => {
    // Mock configured so pushDirtyCards actually queries cards
    mockFindOneExec.mockImplementation(() => Promise.resolve({
      toJSON: () => ({ repoUrl: 'https://github.com/t/r', token: 'tok', branch: 'main' }),
    }));
    mockCardFindOneExec.mockImplementation(() => Promise.resolve({
      toJSON: () => ({
        id: 'deck|hello', deckName: 'deck', source: 'hello',
        translation: 'hi', tags: [], created: '2025-01-01',
        reversible: false, state: null, reverseState: null, suspended: false,
      }),
    }));

    // Rate the same card 3 times
    notifyChange('deck|hello');
    notifyChange('deck|hello');
    notifyChange('deck|hello');
    await vi.advanceTimersByTimeAsync(10_000);

    // Should result in only 1 pushCards call (1 unique card)
    expect(mockPushCards).toHaveBeenCalledTimes(1);
  });
});
