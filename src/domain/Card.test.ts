import { describe, expect, it } from 'vitest';
import { CardSchema } from './Card.ts';
import { CardCadenceSchema } from './Cadence.ts';

const forwardCadence = {
  id: '33333333-3333-4333-8333-333333333333',
  cardId: '11111111-1111-4111-8111-111111111111',
  direction: 'forward' as const,
  nextReviewAt: null,
  intervalDays: null,
  reviewCount: 0,
  lapseCount: 0,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const validCard = {
  id: '11111111-1111-4111-8111-111111111111',
  deckId: '22222222-2222-4222-8222-222222222222',
  name: 'Apple — basic noun',
  frontMarkdown: '<ruby>上<rt>shàng</rt></ruby>',
  backMarkdown: 'morning',
  tags: ['basic'],
  speechText: null,
  speechLocale: null,
  reversible: false,
  suspended: false,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  cadences: [forwardCadence],
};

describe('CardSchema', () => {
  it('accepts the complete canonical Card DTO', () => {
    expect(CardSchema.parse(validCard)).toEqual(validCard);
  });

  it('requires complete independently scheduled cadences', () => {
    expect(CardCadenceSchema.parse(forwardCadence)).toEqual(forwardCadence);
    expect(() => CardCadenceSchema.parse({ ...forwardCadence, direction: 'sideways' })).toThrow();
  });

  it('rejects raw HTML outside the ruby subset', () => {
    expect(() => CardSchema.parse({ ...validCard, frontMarkdown: '<img src="unsafe">' })).toThrow();
  });

  it('requires a readable non-empty name', () => {
    expect(() => CardSchema.parse({ ...validCard, name: '   ' })).toThrow();
  });
});
