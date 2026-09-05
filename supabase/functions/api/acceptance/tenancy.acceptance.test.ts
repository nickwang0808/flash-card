import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { functionUrl } from './test-support/environment.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queue = { horizonHours: 48, limit: 50 };
const actors: TestActor[] = [];
afterEach(async () => { await Promise.all(actors.splice(0).map(destroyActor)); });

describe('authentication, tenancy, and validation boundary', () => {
  test('rejects cross-tenant identifiers without disclosure', async () => {
    const [owner, intruder] = await Promise.all([createActor('owner'), createActor('intruder')]);
    actors.push(owner, intruder);
    const deck = await createDeck(owner, 'Private');
    const card = await createNewCard(owner, deck);

    await expect(intruder.api.deck.queue({ deckId: deck.id, ...queue })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.card.get({ cardId: card.id, deckId: deck.id })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.card.search({ deckId: deck.id, query: 'Front', pagination: { limit: 10 } })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.card.remove({ cardId: card.id, deckId: deck.id, expectedVersion: 0, confirmation: true, queue })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: crypto.randomUUID(), queue })).rejects.toThrow('NOT_FOUND');
  });

  test('derives ownership exclusively from the verified JWT and transports safe validation errors', async () => {
    const [owner, other] = await Promise.all([createActor('owner-input'), createActor('other-input')]);
    actors.push(owner, other);
    const response = await fetch(`${functionUrl}/deck.create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner.accessToken}`, 'Content-Type': 'application/json', 'X-Flashcard-Test-Clock': owner.clock.iso(), 'X-Flashcard-Test-Secret': process.env.FLASHCARD_TEST_CLOCK_SECRET! },
      body: JSON.stringify({ name: 'JWT owned', defaultSpeechLocale: null, userId: other.userId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { data: { id: string } } };
    expect((await owner.api.deck.list()).decks.map((deck) => deck.id)).toContain(body.result.data.id);
    expect((await other.api.deck.list()).decks.map((deck) => deck.id)).not.toContain(body.result.data.id);

    const missing = await fetch(`${functionUrl}/deck.list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(missing.status).toBe(401);
    const malformed = await fetch(`${functionUrl}/deck.queue?input=${encodeURIComponent(JSON.stringify({ deckId: 'not-a-uuid', ...queue }))}`, { headers: { Authorization: `Bearer ${owner.accessToken}` } });
    expect(malformed.status).toBe(400);
    const text = await malformed.text();
    expect(text).not.toMatch(/postgres|postgresql|DATABASE_URL|stack/i);
  });
});
