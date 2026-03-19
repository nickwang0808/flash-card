import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRxDatabase, type RxDatabase } from 'rxdb/plugins/core';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { RxDbCardRepository } from '../../src/services/card-repository';

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
    tags: { type: 'string' },
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
    id: { type: 'string', maxLength: 300 },
    user_id: { type: 'string', maxLength: 100 },
    card_id: { type: 'string', maxLength: 300 },
    direction: { type: 'string', maxLength: 10 },
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

async function insertCard(db: RxDatabase, term: string, order: number) {
  await (db as any).cards.insert({
    id: `test-deck|${term}`,
    user_id: 'test-user',
    deck_name: 'test-deck',
    term,
    back: `${term}-back`,
    tags: '[]',
    created: '2025-01-01T00:00:00Z',
    reversible: false,
    order,
    suspended: false,
    approved: true,
  });
}

describe('RxDbCardRepository integration', () => {
  let db: RxDatabase;
  let repo: RxDbCardRepository;

  beforeEach(async () => {
    db = await createRxDatabase({
      name: `testdb-${Date.now()}`,
      storage: getRxStorageMemory(),
      multiInstance: false,
    });
    await db.addCollections({
      cards: { schema: cardsSchema },
      srs_state: { schema: srsStateSchema },
    });
    repo = new RxDbCardRepository(db as any);
  });

  afterEach(async () => {
    await db.remove();
  });

  describe('subscribeCards sorts by order', () => {
    it('returns cards sorted by order, not by primary key or created date', async () => {
      await insertCard(db, '一', 0);
      await insertCard(db, '二', 1);
      await insertCard(db, '三', 2);
      await insertCard(db, '四', 3);
      await insertCard(db, '五', 4);

      const result = await new Promise<string[]>((resolve) => {
        repo.subscribeCards('test-deck', (flashCards) => {
          resolve(flashCards.map((c) => c.term));
        });
      });

      expect(result).toEqual(['一', '二', '三', '四', '五']);
    });

    it('handles reverse insertion order correctly', async () => {
      await insertCard(db, 'e', 4);
      await insertCard(db, 'd', 3);
      await insertCard(db, 'c', 2);
      await insertCard(db, 'b', 1);
      await insertCard(db, 'a', 0);

      const result = await new Promise<string[]>((resolve) => {
        repo.subscribeCards('test-deck', (flashCards) => {
          resolve(flashCards.map((c) => c.term));
        });
      });

      expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('joins srs_state into FlashCard state/reverseState', async () => {
      await insertCard(db, 'hello', 0);
      await (db as any).srs_state.insert({
        id: 'test-deck|hello:forward',
        user_id: 'test-user',
        card_id: 'test-deck|hello',
        direction: 'forward',
        due: '2025-02-01T00:00:00Z',
        stability: 1.5,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 1,
        reps: 1,
        lapses: 0,
        state: 2,
      });

      const card = await repo.getById('test-deck|hello');
      expect(card).not.toBeNull();
      expect(card!.state).not.toBeNull();
      expect(card!.state!.stability).toBe(1.5);
      expect(card!.state!.due).toBeInstanceOf(Date);
      expect(card!.reverseState).toBeNull();
    });
  });
});
