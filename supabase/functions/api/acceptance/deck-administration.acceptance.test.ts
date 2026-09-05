import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from './test-support/actor.ts';
import { closeFixtureDb } from './test-support/database.ts';
import { createDeck, createNewCard } from './test-support/scenarios.ts';

let actor: TestActor | undefined;
let other: TestActor | undefined;
afterEach(async () => {
  await Promise.all([destroyActor(actor), destroyActor(other)]);
  actor = undefined;
  other = undefined;
  await closeFixtureDb();
});

describe('deck administration', () => {
  test('lists deterministically and renames without changing immutable fields', async () => {
    actor = await createActor('deck-list');
    const zulu = await actor.api.deck.create({ name: 'Zulu', defaultSpeechLocale: 'ja-JP' });
    const alpha = await actor.api.deck.create({ name: 'Alpha', defaultSpeechLocale: null });

    expect((await actor.api.deck.list()).decks).toMatchObject([
      { id: alpha.id, name: 'Alpha', defaultSpeechLocale: null },
      { id: zulu.id, name: 'Zulu', defaultSpeechLocale: 'ja-JP' },
    ]);

    actor.clock.advance({ minutes: 1 });
    const renamed = await actor.api.deck.rename({ deckId: zulu.id, name: 'Beta', expectedVersion: 0 });
    expect(renamed).toMatchObject({ id: zulu.id, name: 'Beta', defaultSpeechLocale: 'ja-JP', createdAt: zulu.createdAt, version: 1, updatedAt: actor.clock.iso() });
    expect((await actor.api.deck.list()).decks.map(({ name }) => name)).toEqual(['Alpha', 'Beta']);
  });

  test('enforces tenant-local names and rename compare-and-swap', async () => {
    actor = await createActor('deck-cas-owner');
    other = await createActor('deck-cas-other');
    const alpha = await createDeck(actor, 'Alpha');
    const beta = await createDeck(actor, 'Beta');
    await expect(other.api.deck.create({ name: 'Alpha', defaultSpeechLocale: null })).resolves.toMatchObject({ name: 'Alpha' });
    await expect(actor.api.deck.create({ name: 'Alpha', defaultSpeechLocale: null })).rejects.toThrow('CONFLICT');
    await expect(actor.api.deck.rename({ deckId: beta.id, name: alpha.name, expectedVersion: 0 })).rejects.toThrow('CONFLICT');
    expect((await actor.api.deck.list()).decks.find(({ id }) => id === beta.id)).toMatchObject({ name: 'Beta', version: 0 });

    const results = await Promise.allSettled([
      actor.api.deck.rename({ deckId: beta.id, name: 'Gamma', expectedVersion: 0 }),
      actor.api.deck.rename({ deckId: beta.id, name: 'Delta', expectedVersion: 0 }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (fulfilled[0]?.status !== 'fulfilled' || rejected[0]?.status !== 'rejected') throw new Error('Unexpected rename race result');
    expect(rejected[0].reason.message).toContain('CONFLICT');
    expect(fulfilled[0].value).toMatchObject({ id: beta.id, version: 1 });
    expect((await actor.api.deck.list()).decks.find(({ id }) => id === beta.id)).toMatchObject({ name: fulfilled[0].value.name, version: 1 });
  });

  test('requires confirmation and current version before deleting a nonempty deck', async () => {
    actor = await createActor('deck-remove');
    const deck = await createDeck(actor, 'Cascade');
    const card = await createNewCard(actor, deck);

    await expect(actor.api.mutation('deck.remove', { deckId: deck.id, expectedVersion: 0, confirmation: false })).rejects.toThrow('HTTP 400');
    await expect(actor.api.card.get({ cardId: card.id, deckId: deck.id })).resolves.toMatchObject({ id: card.id });
    const renamed = await actor.api.deck.rename({ deckId: deck.id, name: 'Cascade renamed', expectedVersion: 0 });
    await expect(actor.api.deck.remove({ deckId: deck.id, expectedVersion: 0, confirmation: true })).rejects.toThrow('CONFLICT');
    await expect(actor.api.card.get({ cardId: card.id, deckId: deck.id })).resolves.toMatchObject({ id: card.id });

    await expect(actor.api.deck.remove({ deckId: deck.id, expectedVersion: renamed.version, confirmation: true })).resolves.toEqual({ removed: true });
    expect((await actor.api.deck.list()).decks.map(({ id }) => id)).not.toContain(deck.id);
    await expect(actor.api.card.get({ cardId: card.id, deckId: deck.id })).rejects.toThrow('NOT_FOUND');
  });
});
