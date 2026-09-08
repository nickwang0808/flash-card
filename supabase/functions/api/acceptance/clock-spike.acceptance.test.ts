import { afterEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { Cadence } from '../../../../src/domain/Cadence.ts';
import { toIsoTimestamp } from '../../../../src/domain/primitives.ts';
import { cardCadences, cards, reviewEvents } from '../../../../src/db/schema.ts';
import { destroyActor, createActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb, fixtureDb } from './test-support/database.ts';
import { functionUrl } from './test-support/environment.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queueOptions = { limit: 50 }
const actors: TestActor[] = [];

afterEach(async () => {
  await Promise.all(actors.splice(0).map(destroyActor));
});

describe('request-scoped application clock over the served Edge Function', () => {
  test('keeps concurrent users independent and persists one request instant', async () => {
    const [a, b] = await Promise.all([
      createActor('clock-a', '2026-01-01T12:00:00.000Z'),
      createActor('clock-b', '2030-06-15T08:30:00.000Z'),
    ]);
    actors.push(a, b);
    const [deckA, deckB] = await Promise.all([createDeck(a, 'Clock A'), createDeck(b, 'Clock B')]);
    const [cardA] = await Promise.all([createNewCard(a, deckA), createNewCard(b, deckB)]);

    const [queueA, queueB] = await Promise.all([
      a.api.deck.queue({ deckId: deckA.id, ...queueOptions }),
      b.api.deck.queue({ deckId: deckB.id, ...queueOptions }),
    ]);
    expect(queueA.asOf).toBe('2026-01-01T12:00:00.000Z');
    expect(queueB.asOf).toBe('2030-06-15T08:30:00.000Z');

    a.clock.advance({ minutes: 1 });
    const [advancedA, stableB] = await Promise.all([
      a.api.deck.queue({ deckId: deckA.id, ...queueOptions }),
      b.api.deck.queue({ deckId: deckB.id, ...queueOptions }),
    ]);
    expect(advancedA.asOf).toBe('2026-01-01T12:01:00.000Z');
    expect(stableB.asOf).toBe('2030-06-15T08:30:00.000Z');

    const rated = await a.api.review.rate({ cadenceId: cardA.cadences[0].id, deckId: deckA.id, rating: 'again', expectedVersion: 0, requestId: crypto.randomUUID(), queue: queueOptions });
    const expectedState = new Cadence().rate({ nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 }, 'again', a.clock.now());
    expect(rated.queue.asOf).toBe(a.clock.iso());
    expect(rated.queue.items[0]).toMatchObject({ id: cardA.cadences[0].id, cardId: cardA.id, nextReviewAt: expectedState.nextReviewAt });

    const history = await a.api.review.history({ cadenceId: cardA.cadences[0].id, deckId: deckA.id, pagination: { limit: 10 } });
    expect(history.events).toHaveLength(1);
    expect(history.events[0]).toMatchObject({ id: rated.reviewId, reviewedAt: a.clock.iso(), afterState: expectedState });

    const [event] = await fixtureDb().select().from(reviewEvents).where(eq(reviewEvents.id, rated.reviewId));
    const [updatedCard] = await fixtureDb().select().from(cards).where(eq(cards.id, cardA.id));
    const [updatedCadence] = await fixtureDb().select().from(cardCadences).where(eq(cardCadences.id, cardA.cadences[0].id));
    expect(toIsoTimestamp(event.createdAt)).toBe(a.clock.iso());
    expect(toIsoTimestamp(event.reviewedAt)).toBe(a.clock.iso());
    expect(toIsoTimestamp(updatedCard.updatedAt)).toBe(cardA.updatedAt);
    expect(toIsoTimestamp(updatedCadence.updatedAt)).toBe(a.clock.iso());
    expect(updatedCadence.nextReviewAt === null ? null : toIsoTimestamp(updatedCadence.nextReviewAt)).toBe(expectedState.nextReviewAt);
  });

  test('ignores clock headers without the ephemeral secret', async () => {
    const actor = await createActor('clock-header');
    actors.push(actor);
    const deck = await createDeck(actor, 'Clock header');
    const overridden = '2040-12-31T23:59:59.000Z';
    const response = await fetch(`${functionUrl}/deck.queue?input=${encodeURIComponent(JSON.stringify({ deckId: deck.id, ...queueOptions }))}`, {
      headers: { Authorization: `Bearer ${actor.accessToken}`, 'X-Flashcard-Test-Clock': overridden, 'X-Flashcard-Test-Secret': 'wrong-secret' },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { data: { asOf: string } } };
    expect(body.result.data.asOf).not.toBe(overridden);
    expect(Math.abs(Date.now() - new Date(body.result.data.asOf).getTime())).toBeLessThan(10_000);
  });
});

afterEach(closeFixtureDb);
