import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockGithubApi } from '../mocks/github-api.mock';

vi.mock('../../src/services/github-api', () => ({
  githubApi: mockGithubApi,
  parseRepoUrl: () => ({ owner: 'test', repo: 'repo' }),
}));

vi.mock('../../src/services/query-client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { syncManager } from '../../src/services/sync-manager';
import { cardStore } from '../../src/services/card-store';

describe('SyncManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGithubApi._clearFiles();
    localStorage.clear();
    localStorage.setItem(
      'flash-card-settings',
      JSON.stringify({ repoUrl: 'https://github.com/test/repo', token: 'test-token', newCardsPerDay: 10, reviewOrder: 'random', theme: 'system' }),
    );
  });

  it('reports online status', () => {
    expect(syncManager.isOnline()).toBe(true);
  });

  it('getStatus returns synced when no pending reviews', () => {
    expect(syncManager.getStatus()).toBe('synced');
  });

  it('getStatus returns pending when there are pending reviews', () => {
    cardStore.setPendingReviews([
      { deckName: 'test', cardId: 'hola', state: {} as any, commitMessage: 'test' },
    ]);
    expect(syncManager.getStatus()).toBe('pending');
  });

  it('sync with no pending reviews returns ok', async () => {
    const result = await syncManager.sync();
    expect(result.status).toBe('ok');
  });

  it('sync drains pending reviews with sequential PUT calls', async () => {
    mockGithubApi._setFile('test-deck/state.json', '{}');

    cardStore.setPendingReviews([
      { deckName: 'test-deck', cardId: 'hola', state: { reps: 1 } as any, commitMessage: 'review: hola (Good)' },
      { deckName: 'test-deck', cardId: 'gato', state: { reps: 2 } as any, commitMessage: 'review: gato (Easy)' },
    ]);

    const result = await syncManager.sync();
    expect(result.status).toBe('ok');
    expect(mockGithubApi.writeFile).toHaveBeenCalledTimes(2);
    expect(cardStore.getPendingCount()).toBe(0);
  });

  it('records last sync time', async () => {
    await syncManager.sync();
    const lastSync = syncManager.getLastSyncTime();
    expect(lastSync).not.toBeNull();
  });

  it('getPendingCount returns correct count', () => {
    cardStore.setPendingReviews([
      { deckName: 'a', cardId: '1', state: {} as any, commitMessage: 'x' },
      { deckName: 'a', cardId: '2', state: {} as any, commitMessage: 'y' },
    ]);
    expect(syncManager.getPendingCount()).toBe(2);
  });
});
