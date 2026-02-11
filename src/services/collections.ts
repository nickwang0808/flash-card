import { QueryClient } from '@tanstack/query-core';
import { createCollection, localStorageCollectionOptions, type Collection } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { type Card } from 'ts-fsrs';
import { github } from './github';
import { githubService } from './github-service';

// Stored version of ReviewLog with serialized dates
export interface StoredReviewLog {
  id: string;                  // cardSource:direction:timestamp
  cardSource: string;
  isReverse: boolean;
  rating: number;              // Rating enum value
  state: number;               // State enum value
  due: string;                 // ISO date
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: string;              // ISO date
}

// FlashCard: content + FSRS state in one structure
export interface FlashCard {
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible: boolean;
  state: Card | null;
  reverseState: Card | null;
  suspended?: boolean;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
});

export const decksCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['decks'],
    queryFn: async () => {
      const names = await githubService.listDecks();
      return names.map((name) => ({ name }));
    },
    queryClient,
    getKey: (item) => item.name,
  }),
);

// Collection cache: one collection per deck
const deckCollections = new Map<string, Collection<FlashCard, string>>();

// Factory function: get or create collection for a deck
export function getCardsCollection(deckName: string): Collection<FlashCard, string> {
  if (!deckCollections.has(deckName)) {
    const collection = createCollection(
      queryCollectionOptions({
        queryKey: ['cards', deckName],
        queryFn: async () => githubService.getCards(deckName),
        queryClient,
        getKey: (item) => item.source,

        onUpdate: async ({ transaction }) => {
          const updates = transaction.mutations.map((m) => m.modified as FlashCard);

          // Immediately persist to local synced store (confirms optimistic state)
          collection.utils.writeBatch(() => {
            updates.forEach((item) => {
              collection.utils.writeUpdate(item);
            });
          });

          // Queue GitHub sync in background (debounced, fire-and-forget)
          githubService.updateCards(deckName, updates);

          return { refetch: false };
        },

        onInsert: async ({ transaction }) => {
          const inserts = transaction.mutations.map((m) => m.modified as FlashCard);
          await githubService.updateCards(deckName, inserts);
          return { refetch: false };
        },
      }),
    );
    deckCollections.set(deckName, collection);
  }
  return deckCollections.get(deckName)!;
}

// Refresh all data from GitHub
export async function refreshData(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['decks'] });
  await queryClient.invalidateQueries({ queryKey: ['cards'] });
}

// Get commits from GitHub
export async function getCommits(limit: number = 10) {
  const config = githubService.getConfig();
  return github.getCommits(config, limit);
}

// ReviewLogs collection for undo functionality
export const reviewLogsCollection = createCollection<StoredReviewLog, string>(
  localStorageCollectionOptions({
    storageKey: 'flash-card-review-logs',
    getKey: (item) => item.id,
  }),
);
