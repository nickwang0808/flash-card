import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queue = { limit: 50 };
let actor: TestActor | undefined;
afterEach(async () => { await destroyActor(actor); actor = undefined; await closeFixtureDb(); });

describe('review persistence and history', () => {
  test('makes concurrent idempotent requests one logical review and rejects competing requests', async () => {
    actor = await createActor('review-races');
    const deck = await createDeck(actor);
    const same = await createNewCard(actor, deck);
    const requestId = crypto.randomUUID();
    const replay = await Promise.all([
      actor.api.review.rate({ cardId: same.id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId, queue }),
      actor.api.review.rate({ cardId: same.id, deckId: deck.id, rating: 'again', expectedVersion: 0, requestId, queue }),
    ]);
    expect(replay[0].reviewId).toBe(replay[1].reviewId);
    const sameHistory = await actor.api.review.history({ cardId: same.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(sameHistory.events).toHaveLength(1);
    expect(await actor.api.card.get({ cardId: same.id, deckId: deck.id })).toMatchObject({ version: 1, nextReviewAt: sameHistory.events[0].afterState.nextReviewAt, intervalDays: sameHistory.events[0].afterState.intervalDays });

    const different = await createNewCard(actor, deck);
    const raced = await Promise.allSettled([
      actor.api.review.rate({ cardId: different.id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: crypto.randomUUID(), queue }),
      actor.api.review.rate({ cardId: different.id, deckId: deck.id, rating: 'again', expectedVersion: 0, requestId: crypto.randomUUID(), queue }),
    ]);
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((raced.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('CONFLICT');
    const history = await actor.api.review.history({ cardId: different.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(history.events).toHaveLength(1);
    expect(await actor.api.card.get({ cardId: different.id, deckId: deck.id })).toMatchObject({ version: 1, nextReviewAt: history.events[0].afterState.nextReviewAt });
  });

  test('guards undo order, retains events, and keyset-paginates history', async () => {
    actor = await createActor('review-undo');
    const deck = await createDeck(actor);
    const card = await createNewCard(actor, deck);
    const first = await actor.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: crypto.randomUUID(), queue });
    actor.clock.advance({ minutes: 1 });
    const second = await actor.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'good', expectedVersion: 1, requestId: crypto.randomUUID(), queue });
    const beforeUndo = await actor.api.card.get({ cardId: card.id, deckId: deck.id });
    await expect(actor.api.review.undo({ reviewId: first.reviewId, deckId: deck.id, queue })).rejects.toThrow('INVALID_STATE');
    expect(await actor.api.card.get({ cardId: card.id, deckId: deck.id })).toEqual(beforeUndo);
    await actor.api.review.undo({ reviewId: second.reviewId, deckId: deck.id, queue });
    const afterSecondUndo = await actor.api.card.get({ cardId: card.id, deckId: deck.id });
    await expect(actor.api.review.undo({ reviewId: second.reviewId, deckId: deck.id, queue })).rejects.toThrow('INVALID_STATE');
    expect(await actor.api.card.get({ cardId: card.id, deckId: deck.id })).toEqual(afterSecondUndo);
    await actor.api.review.undo({ reviewId: first.reviewId, deckId: deck.id, queue });
    const history = await actor.api.review.history({ cardId: card.id, deckId: deck.id, pagination: { limit: 1 } });
    const later = await actor.api.review.history({ cardId: card.id, deckId: deck.id, pagination: { limit: 1, cursor: history.pageInfo.nextCursor } });
    expect([...history.events, ...later.events].map(({ id }) => id)).toEqual([second.reviewId, first.reviewId]);
    expect([...history.events, ...later.events].every(({ undoneAt }) => undoneAt !== null)).toBe(true);
    expect(later.pageInfo.nextCursor).toBeNull();
    await expect(actor.api.review.history({ cardId: card.id, deckId: deck.id, pagination: { limit: 1, cursor: 'not-a-cursor' } })).rejects.toThrow('Invalid pagination cursor');
  });
});
