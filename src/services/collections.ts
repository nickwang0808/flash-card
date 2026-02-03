import { QueryClient } from '@tanstack/query-core';
import { createCollection } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { github, getConfig } from './github';
import { settingsStore } from './settings-store';
import { type CardState } from '../utils/fsrs';

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
              ...card,
              // Put id and deckName AFTER spread to ensure they're not overwritten
              id: `${dir.name}/${cardId}`,
              deckName: dir.name,
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

// Card States Collection (read from GitHub, write with onUpdate handler)
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

    // Optimistic updates applied instantly, this syncs to GitHub
    onUpdate: async ({ transaction }) => {
      const config = getConfig();

      // Group mutations by deck
      const byDeck = new Map<string, Array<{ cardId: string; state: CardState }>>();
      for (const m of transaction.mutations) {
        const [deckName, cardId] = (m.key as string).split('/');
        const list = byDeck.get(deckName) || [];
        list.push({ cardId, state: m.modified.state });
        byDeck.set(deckName, list);
      }

      // Write each deck's state.json to GitHub
      for (const [deckName, updates] of byDeck) {
        let existing: Record<string, CardState> = {};
        let sha: string | undefined;

        try {
          const result = await github.readFile(config, `${deckName}/state.json`);
          existing = JSON.parse(result.content);
          sha = result.sha;
        } catch {
          // file doesn't exist yet
        }

        for (const { cardId, state } of updates) {
          existing[cardId] = state;
        }

        await github.writeFile(
          config,
          `${deckName}/state.json`,
          JSON.stringify(existing, null, 2),
          sha,
          `review: ${updates.length} card(s)`,
        );
      }

      return { refetch: false };
    },

    // Handle inserts for new card states
    onInsert: async ({ transaction }) => {
      const config = getConfig();

      // Group mutations by deck
      const byDeck = new Map<string, Array<{ cardId: string; state: CardState }>>();
      for (const m of transaction.mutations) {
        const [deckName, cardId] = (m.key as string).split('/');
        const list = byDeck.get(deckName) || [];
        list.push({ cardId, state: m.modified.state });
        byDeck.set(deckName, list);
      }

      // Write each deck's state.json to GitHub
      for (const [deckName, updates] of byDeck) {
        let existing: Record<string, CardState> = {};
        let sha: string | undefined;

        try {
          const result = await github.readFile(config, `${deckName}/state.json`);
          existing = JSON.parse(result.content);
          sha = result.sha;
        } catch {
          // file doesn't exist yet
        }

        for (const { cardId, state } of updates) {
          existing[cardId] = state;
        }

        await github.writeFile(
          config,
          `${deckName}/state.json`,
          JSON.stringify(existing, null, 2),
          sha,
          `review: ${updates.length} card(s)`,
        );
      }

      return { refetch: false };
    },
  }),
);


// Refresh all data from GitHub
export async function refreshData(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['cards'] });
  await queryClient.invalidateQueries({ queryKey: ['cardStates'] });
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
