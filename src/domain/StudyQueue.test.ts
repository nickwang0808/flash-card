import { describe, expect, it } from 'vitest';
import { StudyQueue } from './StudyQueue';
import type { Card } from './Card';

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
    cadencePhase: null,
    nextReviewAt: null,
    intervalDays: null,
    reviewCount: 0,
    lapseCount: 0,
    schedulerVersion: null,
    version: 0,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    id: overrides.id,
  };
}

describe('StudyQueue', () => {
  const queue = new StudyQueue();

  it('selects active new cards before reviewed cards', () => {
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000003', createdAt: '2026-01-01T00:00:00.000Z' }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: '2026-01-01T11:00:00.000Z', cadencePhase: 'review', intervalDays: 1, schedulerVersion: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000001', createdAt: '2025-12-31T00:00:00.000Z' }),
    ], now, { horizonHours: 48, limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000002',
    ]);
    expect(snapshot.items.map((item) => item.status)).toEqual(['new', 'new', 'due']);
  });

  it('orders ties by card ID and uses the inclusive horizon', () => {
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: '2026-01-03T12:00:00.000Z', cadencePhase: 'review', intervalDays: 1, schedulerVersion: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000001', nextReviewAt: '2026-01-03T12:00:00.000Z', cadencePhase: 'review', intervalDays: 1, schedulerVersion: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000003', nextReviewAt: '2026-01-03T12:00:00.001Z', cadencePhase: 'review', intervalDays: 1, schedulerVersion: 1 }),
    ], now, { horizonHours: 48, limit: 50 });

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    ]);
    expect(snapshot.items.map((item) => item.status)).toEqual(['future', 'future']);
    expect(snapshot.horizon).toBe('2026-01-03T12:00:00.000Z');
  });

  it('excludes suspended and beyond-horizon cards', () => {
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000001', suspended: true }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: '2026-01-03T12:00:00.001Z', cadencePhase: 'review', intervalDays: 1, schedulerVersion: 1 }),
    ], now, { horizonHours: 48, limit: 50 });

    expect(snapshot.items).toEqual([]);
  });

  it('truncates the working set without changing source cards', () => {
    const cards = [
      card({ id: '00000000-0000-0000-0000-000000000001' }),
      card({ id: '00000000-0000-0000-0000-000000000002' }),
    ];
    const before = structuredClone(cards);
    const snapshot = queue.build(cards, now, { horizonHours: 48, limit: 1 });

    expect(snapshot.items).toHaveLength(1);
    expect(cards).toEqual(before);
  });

  it('classifies reviewed cards due at or before server time', () => {
    const snapshot = queue.build([
      card({ id: '00000000-0000-0000-0000-000000000001', nextReviewAt: '2026-01-01T12:00:00.000Z', cadencePhase: 'review', intervalDays: 1, schedulerVersion: 1 }),
      card({ id: '00000000-0000-0000-0000-000000000002', nextReviewAt: '2026-01-01T12:00:00.001Z', cadencePhase: 'review', intervalDays: 1, schedulerVersion: 1 }),
    ], now, { horizonHours: 48, limit: 50 });

    expect(snapshot.items.map((item) => item.status)).toEqual(['due', 'future']);
  });
});
