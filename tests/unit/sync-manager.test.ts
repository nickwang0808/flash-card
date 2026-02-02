import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockGitService } from '../mocks/git-service.mock';

vi.mock('../../src/services/git-service', () => ({
  gitService: mockGitService,
}));

import { syncManager } from '../../src/services/sync-manager';

describe('SyncManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(
      'flash-card-settings',
      JSON.stringify({ repoUrl: 'https://github.com/test/repo', token: 'test-token', newCardsPerDay: 10, reviewOrder: 'random', theme: 'system' }),
    );
  });

  it('reports online status', () => {
    expect(syncManager.isOnline()).toBe(true);
  });

  it('pull calls gitService.pull', async () => {
    const result = await syncManager.pull();
    expect(result.status).toBe('ok');
    expect(mockGitService.pull).toHaveBeenCalled();
  });

  it('push calls gitService.push', async () => {
    const result = await syncManager.push();
    expect(result.status).toBe('ok');
    expect(mockGitService.push).toHaveBeenCalled();
  });

  it('push falls back to pushAsBranch on conflict', async () => {
    mockGitService.push.mockRejectedValueOnce(new Error('not a simple fast-forward'));
    const result = await syncManager.push();
    expect(result.status).toBe('conflict');
    expect(mockGitService.pushAsBranch).toHaveBeenCalled();
  });

  it('records last sync time', async () => {
    await syncManager.pull();
    const lastSync = syncManager.getLastSyncTime();
    expect(lastSync).not.toBeNull();
  });

  it('getStatus returns synced when no unpushed commits', async () => {
    mockGitService.hasUnpushedCommits.mockResolvedValue(false);
    const status = await syncManager.getStatus();
    expect(status).toBe('synced');
  });

  it('getStatus returns pending when unpushed commits exist', async () => {
    mockGitService.hasUnpushedCommits.mockResolvedValue(true);
    const status = await syncManager.getStatus();
    expect(status).toBe('pending');
  });
});
