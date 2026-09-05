import { describe, expect, it } from 'vitest';
import { STUDY_HORIZON_HOURS, StudyQueue } from './StudyQueue.ts';
import type { Card } from './Card.ts';

const now = new Date('2026-01-01T12:00:00.000Z');

function card(overrides: Partial<Omit<Card, 'id'>> & Pick<Card, 'id'>): Card {
  return {
    deckId: '00000000-0000-0000-0000-000000000001',
    name: overrides.name ?? overrides.id,
    frontMarkdown: overrides.frontMarkdown ?? overrides.id,
    backMarkdown: overrides.backMarkdown ?? 'answer',
    tags: overrides.tags ?? [],
    speechText: null,
    speechLocale: null,
    suspended: false,
    nextReviewAt: null,
    intervalDays: null,
    reviewCount: 0,
    lapseCount: 0,
    version: 0,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    id: overrides.id,
  };
}

describe('StudyQueue', () => {
  const queue = new StudyQueue();

  it('selects studied cards before new cards', () => {
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000003', createdAt: '2026-01-01T00:00:00.000Z' }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: '2026-01-01T11:00:00.000Z', intervalDays: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000001', createdAt: '2025-12-31T00:00:00.000Z' }),
    ], now, { limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
    ]);
    expect(snapshot.items.map((item) => item.status)).toEqual(['due', 'new', 'new']);
  });

  it('keeps short future retries before new cards', () => {
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000001' }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: '2026-01-01T12:01:00.000Z', intervalDays: 1 }),
    ], now, { limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
    ]);
    expect(snapshot.items.map((item) => item.status)).toEqual(['future', 'new']);
  });

  it('orders ties by card ID and uses the inclusive twelve-hour horizon', () => {
    const horizon = new Date(now.getTime() + STUDY_HORIZON_HOURS * 3_600_000).toISOString();
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: horizon, intervalDays: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000001', nextReviewAt: horizon, intervalDays: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000003', nextReviewAt: new Date(Date.parse(horizon) + 1).toISOString(), intervalDays: 1 }),
    ], now, { limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    ]);
    expect(snapshot.items.map((item) => item.status)).toEqual(['future', 'future']);
    expect(snapshot.horizon).toBe(horizon);
  });

  it('excludes suspended and beyond-horizon cards', () => {
    const afterHorizon = new Date(now.getTime() + STUDY_HORIZON_HOURS * 3_600_000 + 1).toISOString();
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000001', suspended: true }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: afterHorizon, intervalDays: 1 }),
    ], now, { limit: 50 });

    expect(snapshot.items).toEqual([]);
  });

  it('truncates the reviewed-first working set without changing source cards', () => {
    const cards = [
      card({ id: '00000000-0000-0000-0000-000000000001' }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: now.toISOString(), intervalDays: 1 }),
    ];
    const before = structuredClone(cards);
    const snapshot = queue.build(cards, now, { limit: 1 });

    expect(snapshot.items).toEqual([expect.objectContaining({ id: '00000000-0000-0000-0000-000000000002' })]);
    expect(cards).toEqual(before);
  });

  it('classifies studied cards due at or before server time', () => {
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000001', nextReviewAt: '2026-01-01T12:00:00.000Z', intervalDays: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: '2026-01-01T12:00:00.001Z', intervalDays: 1 }),
    ], now, { limit: 50 });

    expect(snapshot.items.map((item) => item.status)).toEqual(['due', 'future']);
  });
});
