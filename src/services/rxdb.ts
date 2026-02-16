import { createRxDatabase, type RxDatabase, type RxCollection } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

// Schema for cards collection
// FSRS state/reverseState stored as free-form objects (dates as ISO strings)
const cardsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },          // "deckName|term"
    deckName: { type: 'string', maxLength: 100 },
    term: { type: 'string', maxLength: 200 },        // raw key (TTS-readable)
    front: { type: 'string' },                        // markdown (optional, defaults to term)
    back: { type: 'string' },                         // markdown
    tags: { type: 'array', items: { type: 'string' } },
    created: { type: 'string' },
    reversible: { type: 'boolean' },
    order: { type: 'number' },                           // position in cards.json
    state: {},                                         // FSRS Card (free-form JSON)
    reverseState: {},                                  // FSRS Card (free-form JSON)
    suspended: { type: 'boolean' },
  },
  required: ['id', 'deckName', 'term', 'back', 'created', 'reversible', 'order'],
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
    cardId: { type: 'string', maxLength: 300 },
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
  required: ['id', 'cardId'],
} as const;

export type CardDoc = {
  id: string;
  deckName: string;
  term: string;
  front?: string;
  back: string;
  tags?: string[];
  created: string;
  reversible: boolean;
  order: number;
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
  cardId: string;
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

async function createAndSetup(): Promise<AppDatabase> {
  const db = await createRxDatabase<{
    cards: RxCollection<CardDoc>;
    settings: RxCollection<SettingsDoc>;
    reviewlogs: RxCollection<ReviewLogDoc>;
  }>({
    name: 'flashcarddb',
    storage: getRxStorageDexie(),
    multiInstance: false,
    eventReduce: true,
  });
  await db.addCollections({
    cards: { schema: cardsSchema },
    settings: { schema: settingsSchema },
    reviewlogs: { schema: reviewLogsSchema },
  });
  dbInstance = db;
  return db;
}

export function getDatabase(): Promise<AppDatabase> {
  if (!dbPromise) {
    dbPromise = createAndSetup().catch(async (err) => {
      // Schema incompatible — destroy and recreate
      console.warn('Database schema incompatible, recreating...', err);
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        if (dbInfo.name?.startsWith('flashcarddb')) {
          indexedDB.deleteDatabase(dbInfo.name);
        }
      }
      return createAndSetup();
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
