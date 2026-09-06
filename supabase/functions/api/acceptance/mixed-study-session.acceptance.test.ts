import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard, createStudiedCard } from './test-support/scenarios.ts';

const queue = { limit: 50 };
let actor: TestActor | undefined;
afterEach(async () => { await destroyActor(actor); actor = undefined; await closeFixtureDb(); });

describe('mixed study state', () => {
  test('builds deterministic studied-first and twelve-hour replacement snapshots', async () => {
    actor = await createActor('mixed');
    const deck = await createDeck(actor, 'Mixed');
    const base = actor.clock.now().getTime();
    const [newA, newB, overdue, dueNow, future, outside, suspended] = await Promise.all([
      createNewCard(actor, deck, { name: 'new A' }),
      createNewCard(actor, deck, { name: 'new B' }),
      createStudiedCard(actor, deck, { name: 'overdue', nextReviewAt: new Date(base - 60_000).toISOString(), intervalDays: 1 }),
      createStudiedCard(actor, deck, { name: 'due now', nextReviewAt: new Date(base).toISOString() }),
      createStudiedCard(actor, deck, { name: 'future', nextReviewAt: new Date(base + 11 * 3_600_000).toISOString() }),
      createStudiedCard(actor, deck, { name: 'outside', nextReviewAt: new Date(base + 12 * 3_600_000 + 1).toISOString() }),
      createStudiedCard(actor, deck, { name: 'suspended', nextReviewAt: new Date(base - 1).toISOString(), suspended: true }),
    ]);

    const snapshot = await actor.api.deck.queue({ deckId: deck.id, ...queue });
    expect(snapshot.items.map((item) => item.id)).toEqual([
      overdue.id,
      dueNow.id,
      future.id,
      ...[newA.id, newB.id].sort(),
    ]);
    expect(snapshot.items.map((item) => item.id)).not.toContain(outside.id);
    expect(snapshot.items.map((item) => item.id)).not.toContain(suspended.id);
    expect(snapshot.items[2]).toMatchObject({ id: future.id, status: 'future' });

    const firstNew = snapshot.items.find((item) => item.status === 'new')!;
    const rate = await actor.api.review.rate({ cadenceId: firstNew.id, deckId: deck.id, rating: 'again', expectedVersion: 0, requestId: crypto.randomUUID(), queue });
    const retryIndex = rate.queue.items.findIndex((item) => item.id === firstNew.id);
    const remainingNewIndex = rate.queue.items.findIndex((item) => item.status === 'new');
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    expect(retryIndex).toBeLessThan(remainingNewIndex);
    expect(rate.queue.items[retryIndex]).toMatchObject({ status: 'future' });

    const reloaded = await actor.api.deck.queue({ deckId: deck.id, ...queue });
    expect(reloaded).toEqual(rate.queue);
    const history = await actor.api.review.history({ cadenceId: firstNew.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(history.events).toHaveLength(1);

    const undone = await actor.api.review.undo({ reviewId: rate.reviewId, deckId: deck.id, queue });
    expect(undone.queue.items.filter((item) => item.status === 'new').map((item) => item.id)).toEqual([newA.id, newB.id].sort());
  });

  test('backfills limit-one mutation snapshots from persisted queue rows', async () => {
    actor = await createActor('limited-snapshot');
    const deck = await createDeck(actor);
    const first = await createNewCard(actor, deck, { name: 'first' });
    const second = await createNewCard(actor, deck, { name: 'second' });
    const limitOne = { limit: 1 };
    expect((await actor.api.deck.queue({ deckId: deck.id, ...limitOne })).items).toHaveLength(1);
    const rated = await actor.api.review.rate({ cadenceId: first.cadences[0].id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: crypto.randomUUID(), queue: limitOne });
    expect(rated.queue.items.map(({ id }) => id)).toEqual([second.id]);
    expect(rated.queue).toEqual(await actor.api.deck.queue({ deckId: deck.id, ...limitOne }));
    const undone = await actor.api.review.undo({ reviewId: rated.reviewId, deckId: deck.id, queue: limitOne });
    expect(undone.queue).toEqual(await actor.api.deck.queue({ deckId: deck.id, ...limitOne }));
  });
});
