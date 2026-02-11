import { createCollection, localStorageCollectionOptions, type Collection } from '@tanstack/db';
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection';
import { type Card } from 'ts-fsrs';
import { github, parseRepoUrl } from './github';
import { settingsCollection, defaultSettings } from '../hooks/useSettings';
import { getDatabase } from './rxdb';

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
// id and deckName are added by the RxDB layer
export interface FlashCard {
  id: string;                  // composite key: "deckName|source"
  deckName: string;
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

// Collection instances (initialized async)
let cardsCollectionInstance: Collection<FlashCard, string> | null = null;
let decksCollectionInstance: Collection<{ name: string }, string> | null = null;

export async function initCollections(): Promise<void> {
  const db = await getDatabase();

  cardsCollectionInstance = createCollection(
    rxdbCollectionOptions({
      rxCollection: db.cards as any,
      startSync: true,
    }),
  ) as unknown as Collection<FlashCard, string>;

  decksCollectionInstance = createCollection(
    rxdbCollectionOptions({
      rxCollection: db.decks as any,
      startSync: true,
    }),
  ) as unknown as Collection<{ name: string }, string>;
}

export function getCardsCollection(): Collection<FlashCard, string> {
  if (!cardsCollectionInstance) throw new Error('Collections not initialized. Call initCollections() first.');
  return cardsCollectionInstance;
}

export function getDecksCollection(): Collection<{ name: string }, string> {
  if (!decksCollectionInstance) throw new Error('Collections not initialized. Call initCollections() first.');
  return decksCollectionInstance;
}

// Get commits from GitHub
export async function getCommits(limit: number = 10) {
  const settings = settingsCollection.state.get('settings') ?? defaultSettings;
  const { owner, repo } = parseRepoUrl(settings.repoUrl);
  const config = { owner, repo, token: settings.token, branch: settings.branch };
  return github.getCommits(config, limit);
}

// ReviewLogs collection for undo functionality
export const reviewLogsCollection = createCollection<StoredReviewLog, string>(
  localStorageCollectionOptions({
    storageKey: 'flash-card-review-logs',
    getKey: (item) => item.id,
  }),
);
