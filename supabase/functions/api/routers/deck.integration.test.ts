import { afterAll, describe, expect, it } from 'vitest';
import { createCallerFixture, destroyCallerFixture } from './integration.test-support.ts';

const fixture = await createCallerFixture('deck');
afterAll(async () => { await destroyCallerFixture(fixture); });

describe('deck router caller', () => {
  it('creates, lists, renames, and removes only owned decks', async () => {
    const created = await fixture.caller.deck.create({ name: 'Spanish', defaultSpeechLocale: 'es' });
    expect(created.version).toBe(0);
    await expect(fixture.caller.deck.list({})).resolves.toMatchObject({ decks: [{ id: created.id, name: 'Spanish' }] });
    const renamed = await fixture.caller.deck.rename({ deckId: created.id, name: 'Español', expectedVersion: 0 });
    expect(renamed.version).toBe(1);
    await expect(fixture.caller.deck.rename({ deckId: created.id, name: 'Stale', expectedVersion: 0 })).rejects.toThrow('Deck changed since version 0');
    await expect(fixture.caller.deck.remove({ deckId: created.id, expectedVersion: 1, confirmation: true })).resolves.toEqual({ removed: true });
  });

  it('enforces per-user deck-name uniqueness', async () => {
    const first = await fixture.caller.deck.create({ name: 'Unique', defaultSpeechLocale: null });
    await expect(fixture.caller.deck.create({ name: 'Unique', defaultSpeechLocale: null })).rejects.toThrow('A deck named "Unique" already exists');
    await fixture.caller.deck.remove({ deckId: first.id, expectedVersion: 0, confirmation: true });
  });
});
