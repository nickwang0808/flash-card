import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Cadence } from '../../../../src/domain/Cadence.ts';
import { createActor, destroyActor } from './test-support/actor.ts';
import type { TestActor } from './test-support/actor.ts';
import { createDeck } from './test-support/scenarios.ts';

const queue = { limit: 10 };

describe('card history import', () => {
  let actor: TestActor;

  beforeAll(async () => {
    actor = await createActor('card-import', '2026-09-08T12:00:00.000Z');
  });

  afterAll(async () => destroyActor(actor));

  test('atomically imports history, preserves cadence, and hands future reviews to the native scheduler', async () => {
    const deck = await createDeck(actor, 'Imported deck');
    const requestId = randomUUID();
    const firstState = { nextReviewAt: '2026-04-01T06:00:00.000Z', intervalDays: 31, reviewCount: 1, lapseCount: 0 };
    const finalState = { nextReviewAt: '2026-09-08T13:00:00.000Z', intervalDays: 160.5, reviewCount: 2, lapseCount: 1 };
    const input = {
      requestId,
      deckId: deck.id,
      card: {
        name: 'Imported card',
        frontMarkdown: 'Front',
        backMarkdown: 'Back',
        tags: ['imported'],
        speechText: null,
        speechLocale: null,
        speechSide: null,
        reversible: false,
        suspended: false,
      },
      cadences: [{
        direction: 'forward' as const,
        baseState: { nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 },
        reviews: [
          { reviewedAt: '2026-03-01T06:00:00.000Z', rating: null, recalled: true, durationMs: null, afterState: firstState },
          { reviewedAt: '2026-03-01T06:00:00.000Z', rating: null, recalled: false, durationMs: 4000, afterState: finalState },
        ],
      }],
    };

    const imported = await actor.api.card.import(input);
    expect(imported).toMatchObject({ importedReviewCount: 2, alreadyImported: false, card: { version: 0, suspended: false } });
    expect(imported.card.cadences).toMatchObject([{ version: 0, ...finalState }]);

    const cadenceId = imported.card.cadences[0].id;
    const snapshot = await actor.api.deck.queue({ deckId: deck.id, ...queue });
    expect(snapshot.items).toMatchObject([{ id: cadenceId, status: 'future', ...finalState }]);

    const history = await actor.api.review.history({ cadenceId, deckId: deck.id, pagination: { limit: 10 } });
    expect(history.events.map(({ sequence, origin, rating, recalled, durationMs }) => ({ sequence, origin, rating, recalled, durationMs }))).toEqual([
      { sequence: 2, origin: 'imported', rating: null, recalled: false, durationMs: 4000 },
      { sequence: 1, origin: 'imported', rating: null, recalled: true, durationMs: null },
    ]);
    await expect(actor.api.review.undo({ reviewId: history.events[0].id, deckId: deck.id, queue })).rejects.toThrow('Imported reviews cannot be undone');

    const replay = await actor.api.card.import(input);
    expect(replay).toMatchObject({ importedReviewCount: 2, alreadyImported: true, card: { id: imported.card.id } });
    await expect(actor.api.card.import({ ...input, card: { ...input.card, name: 'Different input' } })).rejects.toThrow('IDEMPOTENCY_CONFLICT');

    actor.clock.set(finalState.nextReviewAt);
    const expected = new Cadence().rate(finalState, 'good', actor.clock.now());
    await actor.api.review.rate({ cadenceId, deckId: deck.id, rating: 'good', expectedVersion: 0, requestId: randomUUID(), queue });
    const updated = await actor.api.card.get({ cardId: imported.card.id, deckId: deck.id });
    expect(updated.cadences[0]).toMatchObject({ version: 1, ...expected });
    const updatedHistory = await actor.api.review.history({ cadenceId, deckId: deck.id, pagination: { limit: 10 } });
    expect(updatedHistory.events[0]).toMatchObject({ sequence: 3, origin: 'native', rating: 'good', recalled: true, beforeState: finalState, afterState: expected });
  });
});
