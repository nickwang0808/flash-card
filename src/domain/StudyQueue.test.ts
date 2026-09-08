import { describe, expect, it } from 'vitest';

import type { CardCadence } from './Cadence.ts';
import type { Card } from './Card.ts';
import { STUDY_HORIZON_HOURS, StudyQueue, type StudyQueueCandidate } from './StudyQueue.ts';

const now = new Date('2026-01-01T12:00:00.000Z');

function candidate(
  id: string,
  overrides: Partial<Card> & Partial<CardCadence> = {},
): StudyQueueCandidate {
  const card: Card = {
    id,
    deckId: '00000000-0000-0000-0000-000000000001',
    name: overrides.name ?? id,
    frontMarkdown: overrides.frontMarkdown ?? id,
    backMarkdown: overrides.backMarkdown ?? 'answer',
    tags: overrides.tags ?? [],
    speechText: overrides.speechText ?? null,
    speechLocale: overrides.speechLocale ?? null,
    speechSide: overrides.speechSide ?? null,
    reversible: overrides.reversible ?? false,
    suspended: overrides.suspended ?? false,
    version: 0,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cadences: [],
  };
  const cadence: CardCadence = {
    id,
    cardId: card.id,
    direction: overrides.direction ?? 'forward',
    nextReviewAt: overrides.nextReviewAt ?? null,
    intervalDays: overrides.intervalDays ?? null,
    reviewCount: overrides.reviewCount ?? 0,
    lapseCount: overrides.lapseCount ?? 0,
    version: overrides.version ?? 0,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
  return { card, cadence };
}

describe('StudyQueue', () => {
  const queue = new StudyQueue();

  it('selects studied cadences before new cadences', () => {
    const snapshot = queue.build([
      candidate('00000000-0000-0000-0000-000000000003', { createdAt: '2026-01-01T00:00:00.000Z' }),
      candidate('00000000-0000-0000-0000-000000000002', { nextReviewAt: '2026-01-01T11:00:00.000Z', intervalDays: 1 }),
      candidate('00000000-0000-0000-0000-000000000001', { createdAt: '2025-12-31T00:00:00.000Z' }),
    ], now, { review: 1, new: 2 }, { limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
    ]);
    expect(snapshot.items.map((item) => item.status)).toEqual(['due', 'new', 'new']);
    expect(snapshot.counts).toEqual({ review: 1, new: 2 });
  });

  it('keeps short future retries before new cadences', () => {
    const snapshot = queue.build([
      candidate('00000000-0000-0000-0000-000000000001'),
      candidate('00000000-0000-0000-0000-000000000002', { nextReviewAt: '2026-01-01T12:01:00.000Z', intervalDays: 1 }),
    ], now, { review: 1, new: 1 }, { limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
    ]);
    expect(snapshot.items.map((item) => item.status)).toEqual(['future', 'new']);
  });

  it('orders all new forward cadences before reverse cadences and swaps reverse content', () => {
    const snapshot = queue.build([
      candidate('00000000-0000-0000-0000-000000000004', { cardId: '00000000-0000-0000-0000-000000000002', direction: 'reverse', reversible: true, frontMarkdown: 'A front', backMarkdown: 'A back' }),
      candidate('00000000-0000-0000-0000-000000000003', { cardId: '00000000-0000-0000-0000-000000000001', direction: 'reverse', reversible: true, frontMarkdown: 'B front', backMarkdown: 'B back' }),
      candidate('00000000-0000-0000-0000-000000000002', { direction: 'forward', reversible: true, frontMarkdown: 'A front', backMarkdown: 'A back' }),
      candidate('00000000-0000-0000-0000-000000000001', { direction: 'forward', reversible: true, frontMarkdown: 'B front', backMarkdown: 'B back' }),
    ], now, { review: 0, new: 4 }, { limit: 50 });

    expect(snapshot.items.map((item) => item.direction)).toEqual(['forward', 'forward', 'reverse', 'reverse']);
    expect(snapshot.items[2]).toMatchObject({ frontMarkdown: 'B back', backMarkdown: 'B front' });
  });

  it('moves speech side with reversed content', () => {
    const snapshot = queue.build([
      candidate('00000000-0000-0000-0000-000000000001', { speechText: 'front', speechSide: 'front', direction: 'forward' }),
      candidate('00000000-0000-0000-0000-000000000002', { speechText: 'back', speechSide: 'back', direction: 'forward' }),
      candidate('00000000-0000-0000-0000-000000000003', { speechText: 'front', speechSide: 'front', direction: 'reverse', reversible: true }),
      candidate('00000000-0000-0000-0000-000000000004', { speechText: 'back', speechSide: 'back', direction: 'reverse', reversible: true }),
    ], now, { review: 0, new: 4 });

    expect(snapshot.items.map(({ speechSide }) => speechSide)).toEqual(['front', 'back', 'back', 'front']);
  });

  it('uses the inclusive twelve-hour horizon and excludes suspended cards', () => {
    const horizon = new Date(now.getTime() + STUDY_HORIZON_HOURS * 3_600_000).toISOString();
    const snapshot = queue.build([
      candidate('00000000-0000-0000-0000-000000000002', { nextReviewAt: horizon, intervalDays: 1 }),
      candidate('00000000-0000-0000-0000-000000000001', { suspended: true }),
      candidate('00000000-0000-0000-0000-000000000003', { nextReviewAt: new Date(Date.parse(horizon) + 1).toISOString(), intervalDays: 1 }),
    ], now, { review: 1, new: 0 }, { limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual(['00000000-0000-0000-0000-000000000002']);
    expect(snapshot.items[0].status).toBe('future');
    expect(snapshot.horizon).toBe(horizon);
    expect(snapshot.counts).toEqual({ review: 1, new: 0 });
  });
});
