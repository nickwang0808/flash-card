import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { functionUrl } from './test-support/environment.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queue = { limit: 50 }
const actors: TestActor[] = [];
afterEach(async () => { await Promise.all(actors.splice(0).map(destroyActor)); });

describe('authentication, tenancy, and validation boundary', () => {
  test('rejects cross-tenant identifiers without disclosure', async () => {
    const [owner, intruder] = await Promise.all([createActor('owner'), createActor('intruder')]);
    actors.push(owner, intruder);
    const deck = await createDeck(owner, 'Private');
    const card = await createNewCard(owner, deck, { name: 'Private Front' });
    const rated = await owner.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: crypto.randomUUID(), queue });
    const intruderCard = await createNewCard(intruder, await createDeck(intruder, 'Intruder'), { name: 'Private Front' });

    await expect(intruder.api.deck.queue({ deckId: deck.id, ...queue })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.card.get({ cardId: card.id, deckId: deck.id })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.card.search({ deckId: deck.id, query: 'Front', pagination: { limit: 10 } })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.card.remove({ cardId: card.id, deckId: deck.id, expectedVersion: 1, confirmation: true, queue })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.review.rate({ cardId: card.id, deckId: deck.id, rating: 'good', expectedVersion: 1, requestId: crypto.randomUUID(), queue })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.review.history({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } })).rejects.toThrow('NOT_FOUND');
    await expect(intruder.api.review.undo({ reviewId: rated.reviewId, deckId: deck.id, queue })).rejects.toThrow('NOT_FOUND');

    expect((await owner.api.card.get({ cardId: card.id, deckId: deck.id })).version).toBe(1);
    expect((await owner.api.review.history({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } })).events.map(({ id }) => id)).toEqual([rated.reviewId]);
    const unscoped = await owner.api.card.search({ query: 'Private Front', pagination: { limit: 10 } });
    expect(unscoped.cards.map(({ id }) => id)).toContain(card.id);
    expect(unscoped.cards.map(({ id }) => id)).not.toContain(intruderCard.id);
  });

  test('derives ownership exclusively from the verified JWT and transports safe validation errors', async () => {
    const [owner, other] = await Promise.all([createActor('owner-input'), createActor('other-input')]);
    const session = await owner.api.auth.session();
    expect(session).toMatchObject({ userId: owner.userId, email: owner.email });
    expect(session.issuedAt).toEqual(expect.any(String));
    expect(session.expiresAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(session.issuedAt!))).toBe(false);
    expect(Number.isNaN(Date.parse(session.expiresAt!))).toBe(false);

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
    const invalid = await fetch(`${functionUrl}/auth.session`, { headers: { Authorization: 'Bearer invalid' } });
    expect(invalid.status).toBe(401);
    const invalidText = await invalid.text();
    expect(JSON.parse(invalidText)).toMatchObject({ code: expect.stringMatching(/^UNAUTHORIZED/) });
    expect(invalidText).not.toMatch(/postgres|postgresql|DATABASE_URL|stack/i);

    const malformed = await fetch(`${functionUrl}/deck.queue?input=${encodeURIComponent(JSON.stringify({ deckId: 'not-a-uuid', ...queue }))}`, { headers: { Authorization: `Bearer ${owner.accessToken}` } });
    expect(malformed.status).toBe(400);
    const text = await malformed.text();
    expect(text).not.toMatch(/postgres|postgresql|DATABASE_URL|stack/i);
  });

  test('returns the wildcard-origin CORS preflight contract', async () => {
    const response = await fetch(`${functionUrl}/deck.queue`, { method: 'OPTIONS', headers: { Origin: 'https://acceptance.example' } });
    expect(response.status).toBe(204);
    expect(Object.fromEntries(['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age', 'vary'].map((header) => [header, response.headers.get(header)]))).toEqual({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Flashcard-Test-Clock, X-Flashcard-Test-Secret',
      'access-control-max-age': '86400',
      vary: 'Accept-Encoding, Origin',
    });
});
});
