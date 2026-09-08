import { afterEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { Cadence } from '../../../../src/domain/Cadence.ts';
import { toIsoTimestamp } from '../../../../src/domain/primitives.ts';
import { cardCadences, reviewEvents } from '../../../../src/db/schema.ts';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb, fixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queue = { limit: 50 };
let actor: TestActor | undefined;
afterEach(async () => { await destroyActor(actor); actor = undefined; await closeFixtureDb(); });

describe('one new card study session', () => {
  test('rates, reloads history, reaches due boundary, and restores exact state on undo', async () => {
    actor = await createActor('new-card');
    const deck = await createDeck(actor, 'Spanish');
    const card = await createNewCard(actor, deck, { name: 'Hola', frontMarkdown: 'Hello', backMarkdown: 'Hola', tags: ['greeting'] });

    const initial = await actor.api.deck.queue({ deckId: deck.id, ...queue });
    expect(initial).toMatchObject({ asOf: actor.clock.iso(), items: [{ id: card.cadences[0].id, cardId: card.id, status: 'new', name: 'Hola', frontMarkdown: 'Hello', backMarkdown: 'Hola', tags: ['greeting'] }] });

    const expected = new Cadence().rate({ nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 }, 'good', actor.clock.now());
    const rated = await actor.api.review.rate({ cadenceId: card.cadences[0].id, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: crypto.randomUUID(), queue });
    expect(rated.queue).toMatchObject({ asOf: actor.clock.iso(), items: [] });

    const afterRate = await actor.api.card.get({ cardId: card.id, deckId: deck.id });
    expect(afterRate.cadences[0]).toMatchObject({ version: 1, ...expected, updatedAt: actor.clock.iso() });
    const history = await actor.api.review.history({ cadenceId: card.cadences[0].id, deckId: deck.id, pagination: { limit: 10 } });
    expect(history.events).toMatchObject([{ id: rated.reviewId, rating: 'good', reviewedAt: actor.clock.iso(), beforeState: { nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 }, afterState: expected, undoneAt: null }]);

    actor.clock.set(expected.nextReviewAt!);
    const due = await actor.api.deck.queue({ deckId: deck.id, ...queue });
    expect(due).toMatchObject({ asOf: expected.nextReviewAt, items: [{ id: card.cadences[0].id, cardId: card.id, status: 'due' }] });

    const undone = await actor.api.review.undo({ reviewId: rated.reviewId, deckId: deck.id, queue });
    expect(undone.queue).toMatchObject({ asOf: expected.nextReviewAt, items: [{ id: card.cadences[0].id, cardId: card.id, status: 'new' }] });
    const restored = await actor.api.card.get({ cardId: card.id, deckId: deck.id });
    expect(restored.cadences[0]).toMatchObject({ nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0, version: 2, updatedAt: expected.nextReviewAt });

    const [event] = await fixtureDb().select().from(reviewEvents).where(eq(reviewEvents.id, rated.reviewId));
    const [storedCadence] = await fixtureDb().select().from(cardCadences).where(eq(cardCadences.id, card.cadences[0].id));
    expect(event.undoneAt === null ? null : toIsoTimestamp(event.undoneAt)).toBe(expected.nextReviewAt);
    expect({ ...storedCadence, updatedAt: toIsoTimestamp(storedCadence.updatedAt) }).toMatchObject({ version: 2, nextReviewAt: null, updatedAt: expected.nextReviewAt });
  });
});
