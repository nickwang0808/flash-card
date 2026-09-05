import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queue = { horizonHours: 48, limit: 50 };
let actor: TestActor | undefined;
afterEach(async () => { await destroyActor(actor); actor = undefined; await closeFixtureDb(); });

describe('card and deck lifecycle', () => {
  test('creates, searches, revises, rolls back, suspends, restores, and removes through HTTP', async () => {
    actor = await createActor('lifecycle');
    const deck = await createDeck(actor, 'French');
    const card = await createNewCard(actor, deck, { name: 'Bonjour', frontMarkdown: 'Good morning', backMarkdown: 'Bonjour', tags: ['greeting'] });
    expect(card).toMatchObject({ version: 0, createdAt: actor.clock.iso(), updatedAt: actor.clock.iso() });

    const updated = await actor.api.card.update({ cardId: card.id, deckId: deck.id, name: 'Bonsoir', frontMarkdown: 'Good evening', backMarkdown: 'Bonsoir', tags: ['greeting', 'night'], speechText: null, speechLocale: null, expectedVersion: 0 });
    expect(updated).toMatchObject({ version: 1, name: 'Bonsoir', updatedAt: actor.clock.iso() });
    await expect(actor.api.card.update({ cardId: card.id, deckId: deck.id, name: 'Stale', frontMarkdown: 'Stale', backMarkdown: 'Stale', tags: [], speechText: null, speechLocale: null, expectedVersion: 0 })).rejects.toThrow('CONFLICT');

    const search = await actor.api.card.search({ deckId: deck.id, query: 'night', pagination: { limit: 10 } });
    expect(search.cards).toMatchObject([{ id: card.id, name: 'Bonsoir' }]);
    const revisions = await actor.api.card.revisions({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(revisions.revisions.map((revision) => revision.eventType)).toEqual(expect.arrayContaining(['created', 'edited']));
    const createdRevision = revisions.revisions.find((revision) => revision.eventType === 'created')!;

    actor.clock.advance({ minutes: 1 });
    const rolledBack = await actor.api.card.rollbackRevision({ cardId: card.id, deckId: deck.id, revisionId: createdRevision.id, expectedVersion: 1 });
    expect(rolledBack).toMatchObject({ version: 2, name: 'Bonjour', frontMarkdown: 'Good morning', updatedAt: actor.clock.iso() });

    const suspended = await actor.api.card.suspend({ cardId: card.id, deckId: deck.id, expectedVersion: 2, queue });
    expect(suspended.queue.items).toEqual([]);
    const restored = await actor.api.card.restore({ cardId: card.id, deckId: deck.id, expectedVersion: 3, queue });
    expect(restored).toMatchObject({ card: { id: card.id, version: 4, suspended: false }, queue: { items: [{ id: card.id, status: 'new' }] } });

    await expect(actor.api.card.remove({ cardId: card.id, deckId: deck.id, expectedVersion: 4, confirmation: true, queue })).resolves.toMatchObject({ queue: { items: [] } });
    await expect(actor.api.deck.remove({ deckId: deck.id, expectedVersion: 0, confirmation: true })).resolves.toEqual({ removed: true });
  });
});
