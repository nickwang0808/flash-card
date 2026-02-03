import { QueryClient } from '@tanstack/query-core';
import { createCollection, parseLoadSubsetOptions } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs';
import { github, getConfig } from './github';
import { githubService } from './github-service';

// FlashCard: content + FSRS state in one structure
export interface FlashCard {
  id: string;           // "deckName/cardId"
  deckName: string;
  // Content
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
  // FSRS state (undefined for new cards that haven't been reviewed)
  state?: Card;
}

// FSRS scheduler
const fsrsParams = generatorParameters();
const scheduler = fsrs(fsrsParams);

export function reviewCard(card: Card, rating: Grade, now?: Date): Card {
  return scheduler.repeat(card, now ?? new Date())[rating].card;
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

/**
 * Extract deckName from LoadSubsetOptions where clause.
 * Looks for eq(deckName, value) comparison.
 */
function extractDeckName(opts: { where?: unknown }): string | undefined {
  const parsed = parseLoadSubsetOptions(opts as Parameters<typeof parseLoadSubsetOptions>[0]);
  const deckFilter = parsed.filters.find(
    (f) => f.field.length === 1 && f.field[0] === 'deckName' && f.operator === 'eq',
  );
  return deckFilter?.value as string | undefined;
}

// Single unified collection: cards with content + state
export const cardsCollection = createCollection(
  queryCollectionOptions({
    queryKey: (opts) => ['cards', extractDeckName(opts)],
    queryFn: async (ctx) => {
      const deckName = extractDeckName(ctx.meta?.loadSubsetOptions ?? {});
      return githubService.getCards(deckName);
    },
    queryClient,
    getKey: (item) => item.id,

    // TODO: make sure we are also passing in the deck name
    onUpdate: async ({ transaction }) => {
      const updates = transaction.mutations.map((m) => m.modified as FlashCard);
      await githubService.updateCards(updates);
      return { refetch: false };
    },

    // TODO: make sure we are also passing in the deck name
    onInsert: async ({ transaction }) => {
      const inserts = transaction.mutations.map((m) => m.modified as FlashCard);
      await githubService.updateCards(inserts);
      return { refetch: false };
    },
  }),
);

// Refresh all data from GitHub
export async function refreshData(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['cards'] });
}

// Get commits from GitHub
export async function getCommits(limit: number = 10) {
  const config = getConfig();
  return github.getCommits(config, limit);
}
