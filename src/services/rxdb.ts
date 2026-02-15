import { createRxDatabase, type RxDatabase, type RxCollection } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

// Schema for cards collection
// FSRS state/reverseState stored as free-form objects (dates as ISO strings)
const cardsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },          // "deckName|source"
    deckName: { type: 'string', maxLength: 100 },
    source: { type: 'string', maxLength: 200 },
    translation: { type: 'string' },
    example: { type: 'string' },
    notes: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    created: { type: 'string' },
    reversible: { type: 'boolean' },
    state: {},                                         // FSRS Card (free-form JSON)
    reverseState: {},                                  // FSRS Card (free-form JSON)
    suspended: { type: 'boolean' },
  },
  required: ['id', 'deckName', 'source', 'translation', 'created', 'reversible'],
  indexes: ['deckName'],
} as const;

// Schema for settings collection
const settingsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    repoUrl: { type: 'string' },
    token: { type: 'string' },
    newCardsPerDay: { type: 'number' },
    reviewOrder: { type: 'string', maxLength: 50 },
    theme: { type: 'string', maxLength: 20 },
    branch: { type: 'string' },
    apiBaseUrl: { type: 'string' },
  },
  required: ['id'],
} as const;

// Schema for review logs collection
const reviewLogsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },
    cardSource: { type: 'string', maxLength: 200 },
    isReverse: { type: 'boolean' },
    rating: { type: 'number' },
    state: { type: 'number' },
    due: { type: 'string' },
    stability: { type: 'number' },
    difficulty: { type: 'number' },
    elapsed_days: { type: 'number' },
    last_elapsed_days: { type: 'number' },
    scheduled_days: { type: 'number' },
    review: { type: 'string' },
  },
  required: ['id', 'cardSource'],
} as const;

export type CardDoc = {
  id: string;
  deckName: string;
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible: boolean;
  state: Record<string, unknown> | null;
  reverseState: Record<string, unknown> | null;
  suspended?: boolean;
};

export type SettingsDoc = {
  id: string;
  repoUrl: string;
  token: string;
  newCardsPerDay: number;
  reviewOrder: string;
  theme: string;
  branch?: string;
  apiBaseUrl?: string;
};

export type ReviewLogDoc = {
  id: string;
  cardSource: string;
  isReverse: boolean;
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: string;
};

export type AppDatabase = RxDatabase<{
  cards: RxCollection<CardDoc>;
  settings: RxCollection<SettingsDoc>;
  reviewlogs: RxCollection<ReviewLogDoc>;
}>;

let dbPromise: Promise<AppDatabase> | null = null;
let dbInstance: AppDatabase | null = null;

export function getDatabase(): Promise<AppDatabase> {
  if (!dbPromise) {
    dbPromise = createRxDatabase<{
      cards: RxCollection<CardDoc>;
      settings: RxCollection<SettingsDoc>;
      reviewlogs: RxCollection<ReviewLogDoc>;
    }>({
      name: 'flashcarddb',
      storage: getRxStorageDexie(),
      multiInstance: false,
      eventReduce: true,
    }).then(async (db) => {
      await db.addCollections({
        cards: { schema: cardsSchema },
        settings: { schema: settingsSchema },
        reviewlogs: { schema: reviewLogsSchema },
      });
      dbInstance = db;
      return db;
    });
  }
  return dbPromise;
}

/** Returns the database synchronously. Only safe after bootstrap(). */
export function getDatabaseSync(): AppDatabase {
  if (!dbInstance) throw new Error('Database not initialized. Call getDatabase() first.');
  return dbInstance;
}

export async function destroyDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    await db.remove();
    dbPromise = null;
    dbInstance = null;
  }
}
