import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createStudiedCard } from './test-support/scenarios.ts';

let actor: TestActor | undefined;
afterEach(async () => { await destroyActor(actor); actor = undefined; await closeFixtureDb(); });

describe('queue boundaries', () => {
  test('includes exact horizon, excludes one millisecond outside, and classifies exact due time', async () => {
    actor = await createActor('boundaries');
    const deck = await createDeck(actor, 'Boundaries');
    const now = actor.clock.now().getTime();
    const [due, horizon, outside] = await Promise.all([
      createStudiedCard(actor, deck, { name: 'due', nextReviewAt: new Date(now).toISOString() }),
      createStudiedCard(actor, deck, { name: 'horizon', nextReviewAt: new Date(now + 12 * 3_600_000).toISOString() }),
      createStudiedCard(actor, deck, { name: 'outside', nextReviewAt: new Date(now + 12 * 3_600_000 + 1).toISOString() }),
    ]);
    const snapshot = await actor.api.deck.queue({ deckId: deck.id, limit: 50 });
    expect(snapshot.items).toMatchObject([{ id: due.cadences[0].id, cardId: due.id, status: 'due' }, { id: horizon.cadences[0].id, cardId: horizon.id, status: 'future' }]);
    expect(snapshot.items.map((item) => item.id)).not.toContain(outside.cadences[0].id);

    const limited = await actor.api.deck.queue({ deckId: deck.id, limit: 1 });
    expect(limited.items).toEqual([expect.objectContaining({ id: due.cadences[0].id })]);
    actor.clock.advance({ milliseconds: 1 });
    const after = await actor.api.deck.queue({ deckId: deck.id, limit: 50 });
    expect(after.items[0]).toMatchObject({ id: due.cadences[0].id, status: 'due' });
  });
});
