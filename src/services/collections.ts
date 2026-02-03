import { QueryClient } from '@tanstack/query-core';
import { createCollection } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
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

// Card States Collection (read from GitHub, write directly)
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

// Pending writes queue for background GitHub sync
interface PendingWrite {
  deckName: string;
  cardId: string;
  state: CardState;
  commitMessage: string;
}
let pendingWrites: PendingWrite[] = [];
let isWriting = false;

// Process pending writes in background
async function processPendingWrites(): Promise<void> {
  if (isWriting || pendingWrites.length === 0) return;
  isWriting = true;

  const config = getConfig();

  // Group by deck for efficiency
  const byDeck = new Map<string, PendingWrite[]>();
  for (const write of pendingWrites) {
    const list = byDeck.get(write.deckName) || [];
    list.push(write);
    byDeck.set(write.deckName, list);
  }
  pendingWrites = [];

  for (const [deckName, writes] of byDeck) {
    try {
      // Get current state.json
      let allStates: Record<string, CardState> = {};
      let sha: string | undefined;

      try {
        const result = await github.readFile(config, `${deckName}/state.json`);
        allStates = JSON.parse(result.content);
        sha = result.sha;
      } catch {
        // File doesn't exist yet
      }

      // Apply all pending writes for this deck
      for (const write of writes) {
        allStates[write.cardId] = write.state;
      }

      // Write back to GitHub (single commit for all reviews in this deck)
      const lastWrite = writes[writes.length - 1];
      await github.writeFile(
        config,
        `${deckName}/state.json`,
        JSON.stringify(allStates, null, 2),
        sha,
        writes.length === 1 ? lastWrite.commitMessage : `review: ${writes.length} cards`,
      );
    } catch (err) {
      console.error('Failed to write to GitHub:', err);
      // Re-queue failed writes
      pendingWrites.push(...writes);
    }
  }

  isWriting = false;

  // If more writes queued while processing, continue
  if (pendingWrites.length > 0) {
    processPendingWrites();
  }
}

// Local state cache for optimistic updates (since queryCollection doesn't allow direct writes)
const localStateCache = new Map<string, CardState>();

// Review a card - updates local cache immediately, queues GitHub write
export function reviewCard(
  deckName: string,
  cardId: string,
  rating: Grade,
): CardState {
  const key = `${deckName}/${cardId}`;

  // Get current state from local cache first, then collection
  const cachedState = localStateCache.get(key);
  const collectionRow = cardStatesCollection.get(key);
  const currentState = cachedState ?? collectionRow?.state ?? createNewCardState();

  // Calculate new state using FSRS
  const newState = fsrsReview(currentState, rating);
  const commitMessage = `review: ${cardId} (${ratingName(rating)}) — next due ${newState.due.split('T')[0]}`;

  // Update local cache immediately (optimistic update)
  localStateCache.set(key, newState);

  // Queue GitHub write for background processing
  pendingWrites.push({ deckName, cardId, state: newState, commitMessage });

  // Start background processing (non-blocking)
  processPendingWrites();

  return newState;
}

// Get card state (reads from local cache first, then collection, with fallback to new state)
export function getCardState(deckName: string, cardId: string): CardState {
  const key = `${deckName}/${cardId}`;
  // Check local cache first (for optimistic updates)
  const cachedState = localStateCache.get(key);
  if (cachedState) return cachedState;

  // Then check collection
  const row = cardStatesCollection.get(key);
  return row?.state ?? createNewCardState();
}

// Refresh all data from GitHub
export async function refreshData(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['cards'] });
  await queryClient.invalidateQueries({ queryKey: ['cardStates'] });
}

// Get pending count
export function getPendingCount(): number {
  return pendingWrites.length;
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
