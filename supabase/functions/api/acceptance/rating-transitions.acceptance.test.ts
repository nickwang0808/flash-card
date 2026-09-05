import { afterEach, describe, expect, test } from 'vitest';
import { Cadence } from '../../../../src/domain/Cadence.ts';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queue = { limit: 50 };
let actor: TestActor | undefined;
afterEach(async () => { await destroyActor(actor); actor = undefined; await closeFixtureDb(); });

describe('ratings and idempotency', () => {
  test.each(['again', 'hard', 'good', 'easy'] as const)('applies the exact cadence transition for new-card %s', async (rating) => {
    actor = await createActor(`rating-${rating}`);
    const deck = await createDeck(actor, `Rating ${rating}`);
    const card = await createNewCard(actor, deck);
    const expected = new Cadence().rate({ nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 }, rating, actor.clock.now());
    const result = await actor.api.review.rate({ cardId: card.id, deckId: deck.id, rating, expectedVersion: 0, requestId: crypto.randomUUID(), queue });
    const updated = await actor.api.card.get({ cardId: card.id, deckId: deck.id });
    expect(updated).toMatchObject({ version: 1, ...expected, updatedAt: actor.clock.iso() });
    expect(result.queue).toMatchObject({ asOf: actor.clock.iso() });
    if (expected.nextReviewAt !== null && new Date(expected.nextReviewAt).getTime() <= actor.clock.now().getTime() + 12 * 3_600_000) {
      expect(result.queue.items).toMatchObject([{ id: card.id, nextReviewAt: expected.nextReviewAt }]);
    } else {
      expect(result.queue.items).toEqual([]);
    }
  });

  test('replays one logical request without a second state transition', async () => {
    actor = await createActor('idempotency');
    const deck = await createDeck(actor, 'Idempotency');
    const card = await createNewCard(actor, deck);
    const requestId = crypto.randomUUID();
    const first = await actor.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId, queue });
    actor.clock.advance({ minutes: 1 });
    const replay = await actor.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'easy', expectedVersion: 0, requestId, queue });
    expect(replay.reviewId).toBe(first.reviewId);
    const history = await actor.api.review.history({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(history.events).toHaveLength(1);
    expect(history.events[0]).toMatchObject({ id: first.reviewId, rating: 'good' });
    const updated = await actor.api.card.get({ cardId: card.id, deckId: deck.id });
    expect(updated.version).toBe(1);
    await expect(actor.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: crypto.randomUUID(), queue })).rejects.toThrow('CONFLICT');
  });
});
