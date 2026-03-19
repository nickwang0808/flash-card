import { createRxDatabase, type RxDatabase, type RxCollection } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

// All schemas mirror Postgres tables 1:1 (snake_case) for replicateSupabase.
// _deleted is handled by RxDB replication protocol (not in schema).
// _modified is server-managed (not in schema).

const cardsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },
    user_id: { type: 'string', maxLength: 100 },
    deck_name: { type: 'string', maxLength: 100 },
    term: { type: 'string', maxLength: 200 },
    front: { type: 'string' },
    back: { type: 'string' },
    tags: { type: 'string' },                        // JSON string, e.g. '["animal"]'
    created: { type: 'string' },
    reversible: { type: 'boolean' },
    order: { type: 'number' },
    suspended: { type: 'boolean' },
    approved: { type: 'boolean' },
  },
  required: ['id', 'user_id', 'deck_name', 'term', 'back', 'created'],
  indexes: ['deck_name'],
} as const;

const srsStateSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },           // "cardId:direction"
    user_id: { type: 'string', maxLength: 100 },
    card_id: { type: 'string', maxLength: 300 },
    direction: { type: 'string', maxLength: 10 },     // 'forward' or 'reverse'
    due: { type: 'string' },
    stability: { type: 'number' },
    difficulty: { type: 'number' },
    elapsed_days: { type: 'number' },
    scheduled_days: { type: 'number' },
    reps: { type: 'number' },
    lapses: { type: 'number' },
    state: { type: 'number' },
    last_review: { type: 'string' },
  },
  required: ['id', 'user_id', 'card_id', 'direction'],
  indexes: ['card_id'],
} as const;

const settingsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    user_id: { type: 'string', maxLength: 100 },
    new_cards_per_day: { type: 'number' },
    review_order: { type: 'string', maxLength: 50 },
    theme: { type: 'string', maxLength: 20 },
  },
  required: ['id', 'user_id'],
} as const;

const reviewLogsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },
    user_id: { type: 'string', maxLength: 100 },
    card_id: { type: 'string', maxLength: 300 },
    is_reverse: { type: 'boolean' },
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
  required: ['id', 'user_id', 'card_id'],
} as const;

// --- Doc types (mirror Postgres rows) ---

export type CardDoc = {
  id: string;
  user_id: string;
  deck_name: string;
  term: string;
  front?: string;
  back: string;
  tags?: string;              // JSON string
  created: string;
  reversible: boolean;
  order: number;
  suspended?: boolean;
  approved?: boolean;
};

export type SrsStateDoc = {
  id: string;
  user_id: string;
  card_id: string;
  direction: string;
  due?: string;
  stability?: number;
  difficulty?: number;
  elapsed_days?: number;
  scheduled_days?: number;
  reps?: number;
  lapses?: number;
  state?: number;
  last_review?: string;
};

export type SettingsDoc = {
  id: string;
  user_id: string;
  new_cards_per_day: number;
  review_order: string;
  theme: string;
};

export type ReviewLogDoc = {
  id: string;
  user_id: string;
  card_id: string;
  is_reverse: boolean;
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
  srs_state: RxCollection<SrsStateDoc>;
  settings: RxCollection<SettingsDoc>;
  review_logs: RxCollection<ReviewLogDoc>;
}>;

let dbPromise: Promise<AppDatabase> | null = null;
let dbInstance: AppDatabase | null = null;

async function createAndSetup(): Promise<AppDatabase> {
  const db = await createRxDatabase<{
    cards: RxCollection<CardDoc>;
    srs_state: RxCollection<SrsStateDoc>;
    settings: RxCollection<SettingsDoc>;
    review_logs: RxCollection<ReviewLogDoc>;
  }>({
    name: 'flashcarddb',
    storage: getRxStorageDexie(),
    multiInstance: false,
    eventReduce: true,
  });
  await db.addCollections({
    cards: { schema: cardsSchema },
    srs_state: { schema: srsStateSchema },
    settings: { schema: settingsSchema },
    review_logs: { schema: reviewLogsSchema },
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
