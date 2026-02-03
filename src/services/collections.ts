import { QueryClient } from '@tanstack/query-core';
import { createCollection } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { startOfflineExecutor, IndexedDBAdapter } from '@tanstack/offline-transactions';
import { github, getConfig } from './github';
import { settingsStore } from './settings-store';
import {
  type CardState,
  createNewCardState,
  reviewCard as fsrsReview,
  ratingName,
  type Grade,
} from '../utils/fsrs';

// Types
export interface CardData {
  id: string;
  deckName: string;
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
}

export interface CardStateRow {
  id: string; // "deckName/cardId"
  deckName: string;
  cardId: string;
  state: CardState;
}

export interface DeckInfo {
  name: string;
  dueCount: number;
  newCount: number;
}

// Query Client
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
});

// Helper to check if configured
function isConfigured(): boolean {
  return settingsStore.isConfigured();
}

// Cards Collection (read-only from GitHub)
export const cardsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['cards'],
    queryFn: async (): Promise<CardData[]> => {
      if (!isConfigured()) return [];

      const config = getConfig();
      const entries = await github.listDirectory(config, '');
      const dirs = entries.filter((e) => e.type === 'dir' && !e.name.startsWith('.'));

      const allCards: CardData[] = [];

      for (const dir of dirs) {
        try {
          const { content } = await github.readFile(config, `${dir.name}/cards.json`);
          const cards: Record<string, Omit<CardData, 'id' | 'deckName'>> = JSON.parse(content);

          for (const [cardId, card] of Object.entries(cards)) {
            allCards.push({
              id: `${dir.name}/${cardId}`,
              deckName: dir.name,
              ...card,
            });
          }
        } catch {
          // Not a deck directory, skip
        }
      }

      return allCards;
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

// Card States Collection (read from GitHub, write via offline transactions)
export const cardStatesCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['cardStates'],
    queryFn: async (): Promise<CardStateRow[]> => {
      if (!isConfigured()) return [];

      const config = getConfig();
      const entries = await github.listDirectory(config, '');
      const dirs = entries.filter((e) => e.type === 'dir' && !e.name.startsWith('.'));

      const allStates: CardStateRow[] = [];

      for (const dir of dirs) {
        try {
          const { content } = await github.readFile(config, `${dir.name}/state.json`);
          const states: Record<string, CardState> = JSON.parse(content);

          for (const [cardId, state] of Object.entries(states)) {
            allStates.push({
              id: `${dir.name}/${cardId}`,
              deckName: dir.name,
              cardId,
              state,
            });
          }
        } catch {
          // No state.json yet, skip
        }
      }

      return allStates;
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

// Offline Executor for durable mutations
export const offlineExecutor = startOfflineExecutor({
  collections: {
    cardStates: cardStatesCollection,
  },
  storage: new IndexedDBAdapter('flash-cards', 'offline-transactions'),
  mutationFns: {
    syncReview: async ({ transaction }) => {
      const config = getConfig();

      // Group mutations by deck
      const byDeck = new Map<string, Array<{ cardId: string; state: CardState; message: string }>>();

      for (const mutation of transaction.mutations) {
        const row = mutation.modified as unknown as CardStateRow & { commitMessage?: string };
        const list = byDeck.get(row.deckName) || [];
        list.push({
          cardId: row.cardId,
          state: row.state,
          message: (row as any).commitMessage || `review: ${row.cardId}`,
        });
        byDeck.set(row.deckName, list);
      }

      // Write each deck's state.json
      for (const [deckName, reviews] of byDeck) {
        // Get current state
        let currentState: Record<string, CardState> = {};
        let sha: string | undefined;

        try {
          const result = await github.readFile(config, `${deckName}/state.json`);
          currentState = JSON.parse(result.content);
          sha = result.sha;
        } catch {
          // File doesn't exist, will create
        }

        // Apply reviews sequentially (each gets its own commit)
        for (const review of reviews) {
          currentState[review.cardId] = review.state;
          const content = JSON.stringify(currentState, null, 2);
          sha = await github.writeFile(config, `${deckName}/state.json`, content, sha, review.message);
        }
      }

      // Invalidate queries to refetch
      queryClient.invalidateQueries({ queryKey: ['cardStates'] });
    },
  },
  onLeadershipChange: (isLeader) => {
    if (!isLeader) {
      console.log('Flash Cards: Running in online-only mode (another tab is leader)');
    }
  },
});

// Review a card - creates an offline transaction
export async function reviewCard(
  deckName: string,
  cardId: string,
  rating: Grade,
): Promise<CardState> {
  // Get current state
  const existingRow = cardStatesCollection.get(`${deckName}/${cardId}`);
  const currentState = existingRow?.state ?? createNewCardState();

  // Calculate new state
  const newState = fsrsReview(currentState, rating);
  const commitMessage = `review: ${cardId} (${ratingName(rating)}) — next due ${newState.due.split('T')[0]}`;

  // Create offline transaction
  const tx = offlineExecutor.createOfflineTransaction({
    mutationFnName: 'syncReview',
    autoCommit: false,
  });

  tx.mutate(() => {
    if (existingRow) {
      cardStatesCollection.update(`${deckName}/${cardId}`, (draft) => {
        draft.state = newState;
        (draft as any).commitMessage = commitMessage;
      });
    } else {
      cardStatesCollection.insert({
        id: `${deckName}/${cardId}`,
        deckName,
        cardId,
        state: newState,
        commitMessage,
      } as CardStateRow & { commitMessage: string });
    }
  });

  await tx.commit();

  return newState;
}

// Get card state (reads from collection, with fallback to new state)
export function getCardState(deckName: string, cardId: string): CardState {
  const row = cardStatesCollection.get(`${deckName}/${cardId}`);
  return row?.state ?? createNewCardState();
}

// Refresh all data from GitHub
export async function refreshData(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['cards'] });
  await queryClient.invalidateQueries({ queryKey: ['cardStates'] });
}

// Get pending transaction count
export async function getPendingCount(): Promise<number> {
  const outbox = await offlineExecutor.peekOutbox();
  return outbox.length;
}

// Check if online
export function isOnline(): boolean {
  return navigator.onLine;
}

// Get commits from GitHub
export async function getCommits(limit: number = 10) {
  const config = getConfig();
  return github.getCommits(config, limit);
}
