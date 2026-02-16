import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRxDatabase, type RxDatabase } from 'rxdb/plugins/core';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { RxDbCardRepository } from '../../src/services/card-repository';
import type { CardData } from '../../src/services/git-storage';

// Minimal schema matching the app's cardsSchema (only the cards collection)
const cardsSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 300 },
    deckName: { type: 'string', maxLength: 100 },
    term: { type: 'string', maxLength: 200 },
    front: { type: 'string' },
    back: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    created: { type: 'string' },
    reversible: { type: 'boolean' },
    order: { type: 'number' },
    state: {},
    reverseState: {},
    suspended: { type: 'boolean' },
  },
  required: ['id', 'deckName', 'term', 'back', 'created', 'reversible', 'order'],
  indexes: ['deckName'],
} as const;

function makeCard(term: string, order: number): CardData {
  return {
    deckName: 'test-deck',
    term,
    back: `${term}-back`,
    created: '2025-01-01T00:00:00Z', // all same timestamp
    reversible: false,
    order,
    state: null,
    reverseState: null,
  };
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
    });
    repo = new RxDbCardRepository(db as any);
  });

  afterEach(async () => {
    await db.remove();
  });

  describe('subscribeCards sorts by order', () => {
    it('returns cards sorted by order, not by primary key or created date', async () => {
      // Insert cards with same created timestamp but different order values
      // Use terms whose Unicode order differs from declaration order
      const cards: CardData[] = [
        makeCard('一', 0),  // U+4E00
        makeCard('二', 1),  // U+4E8C
        makeCard('三', 2),  // U+4E09
        makeCard('四', 3),  // U+56DB
        makeCard('五', 4),  // U+4E94
      ];

      await repo.replaceAll(cards);

      // Subscribe and collect results
      const result = await new Promise<string[]>((resolve) => {
        repo.subscribeCards('test-deck', (flashCards) => {
          resolve(flashCards.map((c) => c.term));
        });
      });

      expect(result).toEqual(['一', '二', '三', '四', '五']);
    });

    it('handles reverse insertion order correctly', async () => {
      // Insert cards in reverse order to ensure sorting is by order field, not insertion order
      const cards: CardData[] = [
        makeCard('e', 4),
        makeCard('d', 3),
        makeCard('c', 2),
        makeCard('b', 1),
        makeCard('a', 0),
      ];

      await repo.replaceAll(cards);

      const result = await new Promise<string[]>((resolve) => {
        repo.subscribeCards('test-deck', (flashCards) => {
          resolve(flashCards.map((c) => c.term));
        });
      });

      expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('preserves order through replaceAll round-trip', async () => {
      const cards: CardData[] = [
        makeCard('alpha', 0),
        makeCard('beta', 1),
        makeCard('gamma', 2),
      ];

      await repo.replaceAll(cards);

      // Read back via getCardDataByIds and verify order is preserved
      const retrieved = await repo.getCardDataByIds([
        'test-deck|alpha',
        'test-deck|beta',
        'test-deck|gamma',
      ]);

      expect(retrieved.map((c) => ({ term: c.term, order: c.order }))).toEqual([
        { term: 'alpha', order: 0 },
        { term: 'beta', order: 1 },
        { term: 'gamma', order: 2 },
      ]);
    });
  });
});
