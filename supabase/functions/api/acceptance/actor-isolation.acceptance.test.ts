import { describe, expect, test } from 'vitest';
import { createActor, destroyActor } from './test-support/actor.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

describe('per-test actor isolation', () => {
  test.concurrent('creates, uses, and removes eight independent authenticated actors', async () => {
    const actors = await Promise.all(Array.from({ length: 8 }, (_, index) => createActor(`isolation-${index}`, `2026-01-01T12:0${index}:00.000Z`)));
    try {
      const decks = await Promise.all(actors.map((actor, index) => createDeck(actor, `Deck ${index}`)));
      const cards = await Promise.all(actors.map((actor, index) => createNewCard(actor, decks[index], { name: `Card ${index}` })));
      const queues = await Promise.all(actors.map((actor, index) => actor.api.deck.queue({ deckId: decks[index].id, limit: 50 })));
      for (let index = 0; index < actors.length; index += 1) {
        expect(queues[index]).toMatchObject({ asOf: actors[index].clock.iso(), items: [{ id: cards[index].id }] });
      }
    } finally {
      await Promise.all(actors.map(destroyActor));
    }
  });
});
