import { createRxDatabase, type RxDatabase, type RxCollection } from 'rxdb/plugins/core';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import {
  cardsSchema, srsStateSchema, settingsSchema, reviewLogsSchema,
  type CardsDoc, type SrsStateDoc, type SettingsDoc, type ReviewLogsDoc,
} from './rxdb-schemas.generated';

// Re-export doc types for consumers
export type { CardsDoc, SrsStateDoc, SettingsDoc, ReviewLogsDoc };
// Keep legacy aliases for existing code
export type CardDoc = CardsDoc;
export type ReviewLogDoc = ReviewLogsDoc;

export type AppDatabase = RxDatabase<{
  cards: RxCollection<CardsDoc>;
  srsState: RxCollection<SrsStateDoc>;
  settings: RxCollection<SettingsDoc>;
  reviewLogs: RxCollection<ReviewLogsDoc>;
}>;

let dbPromise: Promise<AppDatabase> | null = null;
let dbInstance: AppDatabase | null = null;

async function createAndSetup(): Promise<AppDatabase> {
  const db = await createRxDatabase<{
    cards: RxCollection<CardsDoc>;
    srsState: RxCollection<SrsStateDoc>;
    settings: RxCollection<SettingsDoc>;
    reviewLogs: RxCollection<ReviewLogsDoc>;
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
