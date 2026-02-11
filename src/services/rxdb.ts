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

// Schema for decks collection
const decksSchema = {
  version: 0,
  primaryKey: 'name',
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 100 },
  },
  required: ['name'],
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

export type DeckDoc = {
  name: string;
};

export type AppDatabase = RxDatabase<{
  cards: RxCollection<CardDoc>;
  decks: RxCollection<DeckDoc>;
}>;

let dbPromise: Promise<AppDatabase> | null = null;
let dbInstance: AppDatabase | null = null;

export function getDatabase(): Promise<AppDatabase> {
  if (!dbPromise) {
    dbPromise = createRxDatabase<{
      cards: RxCollection<CardDoc>;
      decks: RxCollection<DeckDoc>;
    }>({
      name: 'flashcarddb',
      storage: getRxStorageDexie(),
      multiInstance: false,
      eventReduce: true,
    }).then(async (db) => {
      await db.addCollections({
        cards: { schema: cardsSchema },
        decks: { schema: decksSchema },
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
  }
}
