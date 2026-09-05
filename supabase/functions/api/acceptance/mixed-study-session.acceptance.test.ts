import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard, createStudiedCard } from './test-support/scenarios.ts';

const queue = { horizonHours: 48, limit: 50 };
let actor: TestActor | undefined;
afterEach(async () => { await destroyActor(actor); actor = undefined; await closeFixtureDb(); });

describe('mixed study state', () => {
  test('builds deterministic new-first and horizon-filtered replacement snapshots', async () => {
    actor = await createActor('mixed');
    const deck = await createDeck(actor, 'Mixed');
    const base = actor.clock.now().getTime();
    const [newA, newB, learning, dueReview, future, outside, suspended] = await Promise.all([
      createNewCard(actor, deck, { name: 'new A' }),
      createNewCard(actor, deck, { name: 'new B' }),
      createStudiedCard(actor, deck, { name: 'learning', cadencePhase: 'learning', nextReviewAt: new Date(base - 60_000).toISOString(), intervalDays: 1 }),
      createStudiedCard(actor, deck, { name: 'due review', nextReviewAt: new Date(base).toISOString() }),
      createStudiedCard(actor, deck, { name: 'future', nextReviewAt: new Date(base + 47 * 3_600_000).toISOString() }),
      createStudiedCard(actor, deck, { name: 'outside', nextReviewAt: new Date(base + 48 * 3_600_000 + 1).toISOString() }),
      createStudiedCard(actor, deck, { name: 'suspended', nextReviewAt: new Date(base - 1).toISOString(), suspended: true }),
    ]);

    const snapshot = await actor.api.deck.queue({ deckId: deck.id, ...queue });
    expect(snapshot.items.map((item) => item.id)).toEqual([
      ...[newA.id, newB.id].sort(),
      learning.id,
      dueReview.id,
      future.id,
    ]);
    expect(snapshot.items.map((item) => item.id)).not.toContain(outside.id);
    expect(snapshot.items.map((item) => item.id)).not.toContain(suspended.id);
    expect(snapshot.items.at(-1)).toMatchObject({ id: future.id, status: 'future' });

    const firstNew = snapshot.items[0];
    const rate = await actor.api.review.rate({ cardId: firstNew.id, deckId: deck.id, rating: 'again', expectedVersion: 0, requestId: crypto.randomUUID(), queue });
    expect(rate.queue.items[0].id).toBe(snapshot.items[1].id);
    expect(rate.queue.items.map((item) => item.id)).toContain(firstNew.id);

    const reloaded = await actor.api.deck.queue({ deckId: deck.id, ...queue });
    expect(reloaded).toEqual(rate.queue);
    const history = await actor.api.review.history({ cardId: firstNew.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(history.events).toHaveLength(1);

    const undone = await actor.api.review.undo({ reviewId: rate.reviewId, deckId: deck.id, queue });
    expect(undone.queue.items.filter((item) => item.status === 'new').map((item) => item.id)).toEqual([newA.id, newB.id].sort());
  });
});
