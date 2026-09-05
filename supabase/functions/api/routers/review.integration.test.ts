import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCallerFixture, destroyCallerFixture } from './integration.test-support.ts';

const fixture = await createCallerFixture('review');
afterAll(async () => { await destroyCallerFixture(fixture); });

let deckId: string;
let cardId: string;
beforeAll(async () => {
  const deck = await fixture.caller.deck.create({ name: 'Reviews', defaultSpeechLocale: null });
  deckId = deck.id;
  const card = await fixture.caller.card.create({ deckId, name: 'Hello', frontMarkdown: 'hello', backMarkdown: 'hola', tags: [], speechText: null, speechLocale: null });
  cardId = card.id;
});

const queue = { horizonHours: 48, limit: 50 };
const requestId = '00000000-0000-4000-8000-000000000101';

describe('review router caller', () => {
  it('rates idempotently, applies cadence, and undoes the latest review exactly', async () => {
    const first = await fixture.caller.review.rate({ cardId, deckId, rating: 'good', expectedVersion: 0, requestId, queue });
    expect(first.reviewId).toMatch(/^[0-9a-f-]{36}$/);
    const replay = await fixture.caller.review.rate({ cardId, deckId, rating: 'again', expectedVersion: 0, requestId, queue });
    expect(replay.reviewId).toBe(first.reviewId);
    const card = await fixture.caller.card.get({ cardId, deckId });
    expect(card.reviewCount).toBe(1);
    expect(card.version).toBe(1);
    const history = await fixture.caller.review.history({ cardId, deckId, pagination: { limit: 10 } });
    expect(history.events).toHaveLength(1);
    await expect(fixture.caller.review.undo({ reviewId: first.reviewId, deckId, queue })).resolves.toMatchObject({ queue: { items: [{ status: 'new' }] } });
    const undone = await fixture.caller.card.get({ cardId, deckId });
    expect(undone.cadencePhase).toBeNull();
    expect(undone.nextReviewAt).toBeNull();
    expect(undone.version).toBe(2);
  });
});
