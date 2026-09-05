import { beforeEach, describe, expect, it } from 'vitest';
import { Cadence } from '../../../../src/domain/Cadence.ts';
import { StudyQueue } from '../../../../src/domain/StudyQueue.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { StudyService } from './StudyService.ts';
import { FakeStudyRepository, makeCard } from '../repositories/fakes.test-support.ts';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const DECK_ID = '00000000-0000-4000-8000-000000000001';
const CARD_ID = '00000000-0000-4000-8000-000000000010';
const REQUEST_ID = '00000000-0000-4000-8000-0000000000a0';

function setup(card = makeCard({ id: CARD_ID, deckId: DECK_ID })) {
  const study = new FakeStudyRepository(new Set([DECK_ID]));
  study.cards.set(card.id, card);
  const service = new StudyService(study, new StudyQueue(), new Cadence());
  return { study, service, card };
}

function callRate(
  service: StudyService,
  overrides: Partial<Parameters<StudyService['rate']>[0]> = {},
): ReturnType<StudyService['rate']> {
  return service.rate({
    cardId: CARD_ID,
    deckId: DECK_ID,
    rating: 'good',
    expectedVersion: 0,
    requestId: REQUEST_ID,
    queue: { horizonHours: 48, limit: 50 },
    now: NOW,
    ...overrides,
  });
}

describe('StudyService.rate', () => {
  it('applies Cadence v1 and returns a replacement queue snapshot', async () => {
    const { service, study, card } = setup();
    const result = await callRate(service);

    const updated = study.cards.get(CARD_ID);
    expect(updated?.cadencePhase).toBe('review');
    expect(updated?.intervalDays).toBe(1);
    expect(updated?.nextReviewAt).toBe('2026-09-05T12:00:00.000Z');
    expect(updated?.reviewCount).toBe(1);
    expect(updated?.version).toBe(1);
    expect(result.reviewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.queue.items).toHaveLength(1);
    expect(result.queue.items[0].id).toBe(CARD_ID);
    // Rated card leaves the new bucket; it is future within the horizon now.
    expect(result.queue.items[0].status).toBe('future');
    expect(card.version).toBe(0); // input card unchanged
  });

  it('keeps an Again card behind remaining new cards', async () => {
    const second = makeCard({ id: '00000000-0000-4000-8000-000000000020', deckId: DECK_ID });
    const { service, study } = setup();
    study.cards.set(second.id, second);

    const result = await callRate(service, { rating: 'again' });

    const updated = study.cards.get(CARD_ID);
    expect(updated?.cadencePhase).toBe('learning');
    expect(updated?.nextReviewAt).toBe('2026-09-04T12:01:00.000Z');
    expect(result.queue.items.map((item) => item.id)).toEqual([second.id, CARD_ID]); // new-first
  });

  it('is idempotent for a repeated request_id', async () => {
    const { service, study } = setup();
    const first = await callRate(service);
    const replay = await callRate(service);

    const updated = study.cards.get(CARD_ID);
    expect(replay.reviewId).toBe(first.reviewId);
    expect(updated?.reviewCount).toBe(1); // applied exactly once
    expect(updated?.version).toBe(1);
  });

  it('resolves a lost unique-key race to the committed review', async () => {
    const { service, study } = setup();
    await callRate(service);

    // A concurrent request with the same request_id committed first.
    study.raceNextInsert = true;
    const replay = await callRate(service);

    const updated = study.cards.get(CARD_ID);
    expect(replay.reviewId).not.toBeUndefined();
    expect(updated?.reviewCount).toBe(1); // still applied exactly once
    expect(updated?.version).toBe(1);
  });

  it('rejects a stale expected_version', async () => {
    const { service } = setup();
    await expect(callRate(service, { expectedVersion: 5 })).rejects.toThrow(
      new ApplicationError('CONFLICT', 'Card changed since version 5'),
    );
  });

  it('does not update cadence state when the event insert fails', async () => {
    const { service, study } = setup();
    study.failNextInsert = true;
    await expect(callRate(service)).rejects.toThrow('simulated insert failure');
    const card = study.cards.get(CARD_ID);
    expect(card?.version).toBe(0);
    expect(study.events).toHaveLength(0);
  });

  it('rejects when the deck is not owned', async () => {
    const { service, study } = setup();
    study.deckIds.delete(DECK_ID);
    await expect(callRate(service)).rejects.toThrow(new ApplicationError('NOT_FOUND', 'Deck not found'));
  });
});

describe('StudyService.undo', () => {
  async function ratedSetup() {
    const { service, study } = setup();
    const { reviewId } = await callRate(service);
    return { service, study, reviewId };
  }

  it('restores the exact before_state and returns a queue', async () => {
    const { service, study, reviewId } = await ratedSetup();
    const result = await service.undo({ reviewId, deckId: DECK_ID, queue: { horizonHours: 48, limit: 50 }, now: NOW });

    const card = study.cards.get(CARD_ID);
    expect(card?.cadencePhase).toBeNull();
    expect(card?.nextReviewAt).toBeNull();
    expect(card?.intervalDays).toBeNull();
    expect(card?.reviewCount).toBe(0);
    expect(card?.version).toBe(2);
    expect(study.events[0].undoneAt).toBe(NOW.toISOString());
    expect(result.items[0].status).toBe('new');
  });

  it('rejects an already-undone review', async () => {
    const { service, reviewId } = await ratedSetup();
    await service.undo({ reviewId, deckId: DECK_ID, queue: {}, now: NOW });
    await expect(service.undo({ reviewId, deckId: DECK_ID, queue: {}, now: NOW })).rejects.toThrow(
      new ApplicationError('INVALID_STATE', 'Review is already undone'),
    );
  });

  it('rejects when a newer active review exists', async () => {
    const { service, reviewId } = await ratedSetup();
    await callRate(service, {
      requestId: '00000000-0000-4000-8000-0000000000b0',
      expectedVersion: 1,
      now: new Date(NOW.getTime() + 60_000),
    });
    await expect(service.undo({ reviewId, deckId: DECK_ID, queue: {}, now: NOW })).rejects.toThrow(
      new ApplicationError('INVALID_STATE', 'Only the latest active review can be undone'),
    );
  });
});

describe('StudyService.getQueue', () => {
  it('builds a new-first snapshot with server time and horizon', async () => {
    const reviewed = makeCard({
      id: '00000000-0000-4000-8000-000000000030',
      deckId: DECK_ID,
      cadencePhase: 'review',
      nextReviewAt: '2026-09-04T11:00:00.000Z',
      intervalDays: 1,
      reviewCount: 1,
      lapseCount: 0,
      schedulerVersion: 1,
    });
    const { service, study } = setup(reviewed);
    study.cards.set(CARD_ID, makeCard({ id: CARD_ID, deckId: DECK_ID, createdAt: '2026-09-02T00:00:00.000Z' }));

    const snapshot = await service.getQueue({ deckId: DECK_ID, options: { horizonHours: 48, limit: 50 }, now: NOW });

    expect(snapshot.asOf).toBe(NOW.toISOString());
    expect(snapshot.horizon).toBe('2026-09-06T12:00:00.000Z');
    expect(snapshot.items.map((item) => item.id)).toEqual([CARD_ID, reviewed.id]); // new card first
    expect(snapshot.items[0].status).toBe('new');
    expect(snapshot.items[1].status).toBe('due'); // next_review_at before asOf
  });

  it('excludes suspended cards from the queue', async () => {
    const { service } = setup(makeCard({ id: CARD_ID, deckId: DECK_ID, suspended: true }));
    const snapshot = await service.getQueue({ deckId: DECK_ID, options: {}, now: NOW });
    expect(snapshot.items).toHaveLength(0);
  });

  it('rejects when the deck is not owned', async () => {
    const { service, study } = setup();
    study.deckIds.delete(DECK_ID);
    await expect(service.getQueue({ deckId: DECK_ID, options: {}, now: NOW })).rejects.toThrow(
      new ApplicationError('NOT_FOUND', 'Deck not found'),
    );
  });
});