import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCallerFixture, destroyCallerFixture } from './integration.test-support.ts';

const fixture = await createCallerFixture('card-a');
const other = await createCallerFixture('card-b');
afterAll(async () => { await destroyCallerFixture(other); await destroyCallerFixture(fixture); });

let deckId: string;
let cardId: string;
beforeAll(async () => {
  const deck = await fixture.caller.deck.create({ name: 'Cards', defaultSpeechLocale: null });
  deckId = deck.id;
  const card = await fixture.caller.card.create({ deckId, name: 'Apple', frontMarkdown: 'fruit', backMarkdown: 'manzana', tags: ['fruit'], speechText: null, speechLocale: null });
  cardId = card.id;
});

const queue = { horizonHours: 48, limit: 50 };
describe('card router caller', () => {
  it('searches, updates, suspends, restores, and records revisions', async () => {
    await expect(fixture.caller.card.search({ deckId, query: 'manzana', pagination: { limit: 10 } })).resolves.toMatchObject({ cards: [{ id: cardId }] });
    const updated = await fixture.caller.card.update({ cardId, deckId, name: 'Apple updated', frontMarkdown: 'fruit', backMarkdown: 'manzana roja', tags: ['fruit', 'red'], speechText: null, speechLocale: null, expectedVersion: 0 });
    expect(updated.version).toBe(1);
    await expect(fixture.caller.card.search({ deckId, query: 'red', pagination: { limit: 10 } })).resolves.toMatchObject({ cards: [{ id: cardId }] });
    await expect(fixture.caller.card.suspend({ cardId, deckId, expectedVersion: 1, queue })).resolves.toMatchObject({ queue: { items: [] } });
    const restored = await fixture.caller.card.restore({ cardId, deckId, expectedVersion: 2, queue });
    expect(restored.card.suspended).toBe(false);
    const revisions = await fixture.caller.card.revisions({ cardId, deckId, pagination: { limit: 10 } });
    expect(revisions.revisions).toHaveLength(2);
    const rolledBack = await fixture.caller.card.rollbackRevision({ cardId, deckId, revisionId: revisions.revisions[1].id, expectedVersion: 3 });
    expect(rolledBack.name).toBe('Apple');
  });

  it('does not expose another tenant card', async () => {
    await expect(other.caller.card.get({ cardId, deckId })).rejects.toThrow('Card not found');
    await expect(other.caller.card.search({ query: 'Apple', pagination: { limit: 10 } })).resolves.toMatchObject({ cards: [] });
    await expect(other.caller.card.update({ cardId, deckId, name: 'stolen', frontMarkdown: 'x', backMarkdown: 'y', tags: [], speechText: null, speechLocale: null, expectedVersion: 0 })).rejects.toThrow('Card not found');
    await expect(other.caller.card.suspend({ cardId, deckId, expectedVersion: 0, queue })).rejects.toThrow('Card not found');
    await expect(other.caller.card.remove({ cardId, deckId, expectedVersion: 0, confirmation: true, queue })).rejects.toThrow('Card not found');
  });
});
