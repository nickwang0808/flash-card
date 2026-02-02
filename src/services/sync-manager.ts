import { gitService, type GitServiceConfig } from './git-service';
import { settingsStore } from './settings-store';
import { cardStore } from './card-store';

const LAST_SYNC_KEY = 'flash-card-last-sync';

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'conflict';
export type SyncResult =
  | { status: 'ok' }
  | { status: 'conflict'; branch: string }
  | { status: 'error'; message: string };

function getConfig(): GitServiceConfig {
  const s = settingsStore.get();
  return { repoUrl: s.repoUrl, token: s.token };
}

export const syncManager = {
  isOnline(): boolean {
    return navigator.onLine;
  },

  getLastSyncTime(): string | null {
    return localStorage.getItem(LAST_SYNC_KEY);
  },

  async getStatus(): Promise<SyncStatus> {
    if (!this.isOnline()) return 'offline';
    const config = getConfig();
    const hasUnpushed = await gitService.hasUnpushedCommits(config);
    if (hasUnpushed) return 'pending';
    return 'synced';
  },

  async pull(): Promise<SyncResult> {
    if (!this.isOnline()) return { status: 'error', message: 'Offline' };
    try {
      await gitService.pull(getConfig());
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { status: 'ok' };
    } catch (e: any) {
      return { status: 'error', message: e.message ?? String(e) };
    }
  },

  async push(): Promise<SyncResult> {
    if (!this.isOnline()) return { status: 'error', message: 'Offline' };
    try {
      await gitService.push(getConfig());
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { status: 'ok' };
    } catch (e: any) {
      // Non-fast-forward means conflict
      if (e.message?.includes('not a simple fast-forward') || e.code === 'PushRejectedError') {
        return this.pushAsBranch();
      }
      return { status: 'error', message: e.message ?? String(e) };
    }
  },

  async pushAsBranch(): Promise<SyncResult> {
    if (!this.isOnline()) return { status: 'error', message: 'Offline' };
    try {
      const branch = await gitService.pushAsBranch(getConfig());
      // Reset local to remote main
      await gitService.pull(getConfig());
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { status: 'conflict', branch };
    } catch (e: any) {
      return { status: 'error', message: e.message ?? String(e) };
    }
  },

  async sync(): Promise<SyncResult> {
    // Recover WAL first
    if (cardStore.hasWALEntries()) {
      await cardStore.recoverFromWAL();
    }

    // Pull first, then push
    const pullResult = await this.pull();
    if (pullResult.status !== 'ok') return pullResult;

    const config = getConfig();
    const hasUnpushed = await gitService.hasUnpushedCommits(config);
    if (!hasUnpushed) return { status: 'ok' };

    return this.push();
  },
};
