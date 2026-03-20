import { createRxDatabase, type RxDatabase, type RxCollection } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

// All schemas mirror Postgres columns 1:1 (camelCase) for replicateSupabase.
// _deleted is handled by RxDB replication protocol (not in schema).
// _modified is server-managed (not in schema).

const cardsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },
    userId: { type: 'string', maxLength: 100 },
    deckName: { type: 'string', maxLength: 100 },
    term: { type: 'string', maxLength: 200 },
    front: { type: 'string' },
    back: { type: 'string' },
    tags: { type: 'string' },                        // JSON string
    created: { type: 'string' },
    reversible: { type: 'boolean' },
    order: { type: 'number' },
    suspended: { type: 'boolean' },
    approved: { type: 'boolean' },
  },
  required: ['id', 'userId', 'deckName', 'term', 'back', 'created'],
  indexes: ['deckName'],
} as const;

const srsStateSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },
    userId: { type: 'string', maxLength: 100 },
    cardId: { type: 'string', maxLength: 300 },
    direction: { type: 'string', maxLength: 10 },
    due: { type: 'string' },
    stability: { type: 'number' },
    difficulty: { type: 'number' },
    elapsedDays: { type: 'number' },
    scheduledDays: { type: 'number' },
    reps: { type: 'number' },
    lapses: { type: 'number' },
    state: { type: 'number' },
    lastReview: { type: 'string' },
  },
  required: ['id', 'userId', 'cardId', 'direction'],
  indexes: ['cardId'],
} as const;

const settingsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    userId: { type: 'string', maxLength: 100 },
    newCardsPerDay: { type: 'number' },
    reviewOrder: { type: 'string', maxLength: 50 },
    theme: { type: 'string', maxLength: 20 },
  },
  required: ['id', 'userId'],
} as const;

const reviewLogsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },
    userId: { type: 'string', maxLength: 100 },
    cardId: { type: 'string', maxLength: 300 },
    isReverse: { type: 'boolean' },
    rating: { type: 'number' },
    state: { type: 'number' },
    due: { type: 'string' },
    stability: { type: 'number' },
    difficulty: { type: 'number' },
    elapsedDays: { type: 'number' },
    lastElapsedDays: { type: 'number' },
    scheduledDays: { type: 'number' },
    review: { type: 'string' },
  },
  required: ['id', 'userId', 'cardId'],
} as const;

export type CardDoc = {
  id: string;
  userId: string;
  deckName: string;
  term: string;
  front?: string;
  back: string;
  tags?: string;
  created: string;
  reversible: boolean;
  order: number;
  suspended?: boolean;
  approved?: boolean;
};

export type SrsStateDoc = {
  id: string;
  userId: string;
  cardId: string;
  direction: string;
  due?: string;
  stability?: number;
  difficulty?: number;
  elapsedDays?: number;
  scheduledDays?: number;
  reps?: number;
  lapses?: number;
  state?: number;
  lastReview?: string;
};

export type SettingsDoc = {
  id: string;
  userId: string;
  newCardsPerDay: number;
  reviewOrder: string;
  theme: string;
};

export type ReviewLogDoc = {
  id: string;
  userId: string;
  cardId: string;
  isReverse: boolean;
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  review: string;
};

export type AppDatabase = RxDatabase<{
  cards: RxCollection<CardDoc>;
  srsState: RxCollection<SrsStateDoc>;
  settings: RxCollection<SettingsDoc>;
  reviewLogs: RxCollection<ReviewLogDoc>;
}>;

let dbPromise: Promise<AppDatabase> | null = null;
let dbInstance: AppDatabase | null = null;

async function createAndSetup(): Promise<AppDatabase> {
  const db = await createRxDatabase<{
    cards: RxCollection<CardDoc>;
    srsState: RxCollection<SrsStateDoc>;
    settings: RxCollection<SettingsDoc>;
    reviewLogs: RxCollection<ReviewLogDoc>;
  }>({
    name: 'flashcarddb',
    storage: getRxStorageDexie(),
    multiInstance: false,
    eventReduce: true,
  });
  await db.addCollections({
    cards: { schema: cardsSchema },
    srsState: { schema: srsStateSchema },
    settings: { schema: settingsSchema },
    reviewLogs: { schema: reviewLogsSchema },
  });
  dbInstance = db;
  return db;
}

export function getDatabase(): Promise<AppDatabase> {
  if (!dbPromise) {
    dbPromise = createAndSetup().catch(async (err) => {
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
