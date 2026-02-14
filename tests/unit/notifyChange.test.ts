import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies of replication.ts so it loads cleanly
vi.mock('rxdb/plugins/replication', () => ({
  replicateRxCollection: vi.fn(),
}));

const mockFindOneExec = vi.fn(() => Promise.resolve(null));
vi.mock('../../src/services/rxdb', () => ({
  getDatabaseSync: vi.fn(() => ({
    settings: { findOne: vi.fn(() => ({ exec: mockFindOneExec })) },
  })),
}));

vi.mock('../../src/services/github', () => ({
  github: {},
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

// Import the real debounce functions — runSync will call isConfigured → getDatabaseSync
import { notifyChange, flushSync, cancelReplication } from '../../src/services/replication';
import { getDatabaseSync } from '../../src/services/rxdb';

describe('notifyChange debounce', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await cancelReplication();
    vi.mocked(getDatabaseSync).mockClear();
    mockFindOneExec.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: getDatabaseSync is called when runSync → isConfigured runs.
  // We use its call count as evidence that runSync was invoked.
  function syncCallCount() {
    return vi.mocked(getDatabaseSync).mock.calls.length;
  }

  it('debounce resets on each call, fires once after idle', async () => {
    notifyChange();
    await vi.advanceTimersByTimeAsync(5_000); // 5s — not yet
    expect(syncCallCount()).toBe(0);

    notifyChange(); // reset timer
    await vi.advanceTimersByTimeAsync(5_000); // 5s after second call — not yet
    expect(syncCallCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000); // 10s after second call — fires
    expect(syncCallCount()).toBe(1);
  });

  it('max batch (10 changes) triggers immediate flush', async () => {
    for (let i = 0; i < 9; i++) {
      notifyChange();
    }
    // Allow any microtasks to settle
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCallCount()).toBe(0);

    notifyChange(); // 10th change — immediate flush
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCallCount()).toBe(1);
  });

  it('counter resets after flush', async () => {
    // Trigger immediate flush via max batch
    for (let i = 0; i < 10; i++) {
      notifyChange();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCallCount()).toBe(1);

    vi.mocked(getDatabaseSync).mockClear();

    // Another 10 should trigger a second flush
    for (let i = 0; i < 10; i++) {
      notifyChange();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCallCount()).toBe(1);
  });

  it('flushSync triggers sync when changes pending', async () => {
    notifyChange();
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCallCount()).toBe(1);
  });

  it('flushSync is a no-op when no changes pending', async () => {
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncCallCount()).toBe(0);
  });

  it('cancelReplication cleans up timer', async () => {
    notifyChange();
    await cancelReplication();
    vi.mocked(getDatabaseSync).mockClear();

    await vi.advanceTimersByTimeAsync(15_000); // well past debounce
    expect(syncCallCount()).toBe(0);
  });
});
