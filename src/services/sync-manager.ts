import { githubApi, parseRepoUrl, type GitHubConfig } from './github-api';
import { settingsStore } from './settings-store';
import { cardStore, type PendingReview } from './card-store';
import { queryClient } from './query-client';
import type { CardState } from '../utils/fsrs';

const LAST_SYNC_KEY = 'flash-card-last-sync';

export type SyncStatus = 'synced' | 'pending' | 'offline';
export type SyncResult =
  | { status: 'ok' }
  | { status: 'error'; message: string };

function getConfig(): GitHubConfig {
  const s = settingsStore.get();
  const { owner, repo } = parseRepoUrl(s.repoUrl);
  return { owner, repo, token: s.token };
}

export const syncManager = {
  isOnline(): boolean {
    return navigator.onLine;
  },

  getLastSyncTime(): string | null {
    return localStorage.getItem(LAST_SYNC_KEY);
  },

  getStatus(): SyncStatus {
    if (!this.isOnline()) return 'offline';
    if (cardStore.hasPendingReviews()) return 'pending';
    return 'synced';
  },

  getPendingCount(): number {
    return cardStore.getPendingCount();
  },

  async sync(): Promise<SyncResult> {
    if (!this.isOnline()) return { status: 'error', message: 'Offline' };

    const pending = cardStore.getPendingReviews();
    if (pending.length === 0) {
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { status: 'ok' };
    }

    const config = getConfig();

    try {
      // Group pending reviews by deck
      const byDeck = new Map<string, PendingReview[]>();
      for (const p of pending) {
        const list = byDeck.get(p.deckName) || [];
        list.push(p);
        byDeck.set(p.deckName, list);
      }

      for (const [deckName, reviews] of byDeck) {
        // Get current state.json and its SHA
        let currentState: Record<string, CardState> = {};
        let sha: string;
        try {
          const result = await githubApi.readFile(config, `${deckName}/state.json`);
          currentState = JSON.parse(result.content);
          sha = result.sha;
        } catch {
          // state.json doesn't exist yet — we'll create it
          // Use a special empty SHA for creation
          sha = '';
          currentState = {};
        }

        // Apply each review sequentially, committing each one
        for (const review of reviews) {
          currentState[review.cardId] = review.state;
          const content = JSON.stringify(currentState, null, 2);

          if (sha === '') {
            // Create new file (no sha parameter)
            const res = await fetch(
              `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${deckName}/state.json`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${config.token}`,
                  Accept: 'application/vnd.github.v3+json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  message: review.commitMessage,
                  content: btoa(Array.from(new TextEncoder().encode(content), b => String.fromCharCode(b)).join('')),
                }),
              },
            );
            if (!res.ok) throw new Error(`GitHub API ${res.status}`);
            const data = await res.json();
            sha = data.content.sha;
          } else {
            sha = await githubApi.writeFile(
              config,
              `${deckName}/state.json`,
              content,
              sha,
              review.commitMessage,
            );
          }
        }
      }

      // Clear pending queue on success
      cardStore.setPendingReviews([]);

      // Invalidate query cache to re-fetch fresh data
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });

      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { status: 'ok' };
    } catch (e: any) {
      return { status: 'error', message: e.message ?? String(e) };
    }
  },

  async getCommits(limit: number = 10) {
    const config = getConfig();
    return githubApi.getCommits(config, limit);
  },
};
