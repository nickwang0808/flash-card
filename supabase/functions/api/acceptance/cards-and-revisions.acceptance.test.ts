import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

const queue = { limit: 50 }
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
    expect(restored).toMatchObject({ card: { id: card.id, version: 4, suspended: false }, queue: { items: [{ id: card.cadences[0].id, cardId: card.id, status: 'new' }] } });

    await expect(actor.api.card.remove({ cardId: card.id, deckId: deck.id, expectedVersion: 4, confirmation: true, queue })).resolves.toMatchObject({ queue: { items: [] } });
    await expect(actor.api.deck.remove({ deckId: deck.id, expectedVersion: 0, confirmation: true })).resolves.toEqual({ removed: true });
  });

  test('creates both directional cadences for reversible cards and queues forwards first', async () => {
    actor = await createActor('reversible-card');
    const deck = await createDeck(actor);
    const [first, second] = await Promise.all([
      createNewCard(actor, deck, { name: 'First', frontMarkdown: 'one', backMarkdown: 'uno', reversible: true }),
      createNewCard(actor, deck, { name: 'Second', frontMarkdown: 'two', backMarkdown: 'dos', reversible: true }),
    ]);

    expect(first.cadences.map(({ direction }) => direction)).toEqual(['forward', 'reverse']);
    expect(second.cadences.map(({ direction }) => direction)).toEqual(['forward', 'reverse']);
    const queueSnapshot = await actor.api.deck.queue({ deckId: deck.id, limit: 50 });
    expect(queueSnapshot.items.map(({ direction }) => direction)).toEqual(['forward', 'forward', 'reverse', 'reverse']);
    expect(queueSnapshot.items.find((item) => item.id === first.cadences.find((cadence) => cadence.direction === 'reverse')?.id)).toMatchObject({
      cardId: first.id,
      frontMarkdown: 'uno',
      backMarkdown: 'one',
    });
  });

  test('persists every mutable field, paginates revisions, and preserves tags on rollback', async () => {
    actor = await createActor('content-revisions');
    const deck = await createDeck(actor);
    const original = { name: 'Original', frontMarkdown: 'Original front', backMarkdown: 'Original back', speechText: 'こんにちは', speechLocale: 'ja-JP' };
    const card = await actor.api.card.create({ deckId: deck.id, ...original, tags: ['original'] });
    expect(card).toMatchObject({ ...original, tags: ['original'] });
    expect(await actor.api.card.get({ cardId: card.id, deckId: deck.id })).toMatchObject({ ...original, tags: ['original'] });
    actor.clock.advance({ minutes: 1 });
    const edited = { name: 'Edited', frontMarkdown: 'Edited front', backMarkdown: 'Edited back', speechText: 'こんばんは', speechLocale: 'ja-JP' };
    await expect(actor.api.card.update({ cardId: card.id, deckId: deck.id, ...edited, tags: ['edited'], expectedVersion: 0 })).resolves.toMatchObject({ ...edited, tags: ['edited'], version: 1 });
    expect((await actor.api.card.search({ deckId: deck.id, query: 'Edited front', pagination: { limit: 10 } })).cards).toMatchObject([{ id: card.id, ...edited, tags: ['edited'] }]);
    const first = await actor.api.card.revisions({ cardId: card.id, deckId: deck.id, pagination: { limit: 1 } });
    expect(first.revisions).toMatchObject([{ eventType: 'edited', beforeContent: original, afterContent: edited }]);
    expect(first.pageInfo.nextCursor).not.toBeNull();
    expect(first.revisions[0].afterContent).not.toHaveProperty('tags');
    const second = await actor.api.card.revisions({ cardId: card.id, deckId: deck.id, pagination: { limit: 1, cursor: first.pageInfo.nextCursor } });
    expect(second).toMatchObject({ revisions: [{ eventType: 'created', beforeContent: null, afterContent: original }], pageInfo: { nextCursor: null } });
    expect(second.revisions[0].afterContent).not.toHaveProperty('tags');
    actor.clock.advance({ minutes: 1 });
    const restored = await actor.api.card.rollbackRevision({ cardId: card.id, deckId: deck.id, revisionId: second.revisions[0].id, expectedVersion: 1 });
    expect(restored).toMatchObject({ ...original, tags: ['edited'], version: 2, updatedAt: actor.clock.iso() });
    expect((await actor.api.card.revisions({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } })).revisions.map(({ eventType }) => eventType)).toContain('restored');
  });

  test('serializes card updates and traverses scoped and unscoped search cursors', async () => {
    actor = await createActor('card-cas-search');
    const deckA = await createDeck(actor, 'A');
    const deckB = await createDeck(actor, 'B');
    const raced = await createNewCard(actor, deckA, { name: 'Raced marker' });
    const updates = await Promise.allSettled([
      actor.api.card.update({ cardId: raced.id, deckId: deckA.id, name: 'Winner one', frontMarkdown: 'one', backMarkdown: 'one', tags: [], speechText: null, speechLocale: null, expectedVersion: 0 }),
      actor.api.card.update({ cardId: raced.id, deckId: deckA.id, name: 'Winner two', frontMarkdown: 'two', backMarkdown: 'two', tags: [], speechText: null, speechLocale: null, expectedVersion: 0 }),
    ]);
    const winner = updates.find((result) => result.status === 'fulfilled');
    expect(winner?.status).toBe('fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('No update won');
    expect(updates.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await actor.api.card.get({ cardId: raced.id, deckId: deckA.id })).toMatchObject({ name: winner.value.name, version: 1 });
    expect((await actor.api.card.revisions({ cardId: raced.id, deckId: deckA.id, pagination: { limit: 10 } })).revisions.map(({ eventType }) => eventType).sort()).toEqual(['created', 'edited']);
    actor.clock.advance({ minutes: 1 });
    const a1 = await createNewCard(actor, deckA, { name: 'Marker one' });
    actor.clock.advance({ minutes: 1 });
    const a2 = await createNewCard(actor, deckA, { name: 'Marker two' });
    actor.clock.advance({ minutes: 1 });
    const b = await createNewCard(actor, deckB, { name: 'Marker three' });
    const page1 = await actor.api.card.search({ deckId: deckA.id, query: 'Marker', pagination: { limit: 1 } });
    const page2 = await actor.api.card.search({ deckId: deckA.id, query: 'Marker', pagination: { limit: 1, cursor: page1.pageInfo.nextCursor } });
    expect([page1, page2].flatMap(({ cards }) => cards.map(({ id }) => id))).toEqual([a2.id, a1.id]);
    expect(page1.pageInfo.nextCursor).not.toBeNull();
    expect(page2.pageInfo.nextCursor).toBeNull();
    const all = await actor.api.card.search({ query: 'Marker', pagination: { limit: 2 } });
    const allNext = await actor.api.card.search({ query: 'Marker', pagination: { limit: 2, cursor: all.pageInfo.nextCursor } });
    expect([...all.cards, ...allNext.cards].map(({ id }) => id)).toEqual([b.id, a2.id, a1.id]);
    expect(allNext.pageInfo.nextCursor).toBeNull();
  });
});
