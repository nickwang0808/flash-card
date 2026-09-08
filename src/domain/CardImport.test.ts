import { describe, expect, it } from 'vitest';

import { CardImportInputSchema, type CardImportInput } from './CardImport.ts';

const freshState = { nextReviewAt: null, intervalDays: null, reviewCount: 0, lapseCount: 0 };
const firstState = { nextReviewAt: '2026-02-01T00:00:00.000Z', intervalDays: 31.5, reviewCount: 1, lapseCount: 0 };
const secondState = { nextReviewAt: '2026-03-01T00:00:00.000Z', intervalDays: 59, reviewCount: 2, lapseCount: 0 };
const input: CardImportInput = {
  requestId: '11111111-1111-4111-8111-111111111111',
  deckId: '22222222-2222-4222-8222-222222222222',
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
    direction: 'forward',
    baseState: freshState,
    reviews: [
      { reviewedAt: '2026-01-01T00:00:00.000Z', rating: null, recalled: true, durationMs: null, afterState: firstState },
      { reviewedAt: '2026-01-01T00:00:00.000Z', rating: null, recalled: true, durationMs: 1000, afterState: secondState },
    ],
  }],
};

describe('CardImportInputSchema', () => {
  it('accepts fractional intervals and preserves same-time review array order', () => {
    expect(CardImportInputSchema.parse(input)).toEqual(input);
  });

  it('requires the imported history to form a state chain', () => {
    const broken = structuredClone(input);
    broken.cadences[0].reviews[1].afterState.reviewCount = 4;
    expect(CardImportInputSchema.safeParse(broken).success).toBe(false);
  });

  it('requires a result without inventing a native rating', () => {
    const broken = structuredClone(input);
    broken.cadences[0].reviews[0].recalled = null;
    expect(CardImportInputSchema.safeParse(broken).success).toBe(false);
  });

  it('requires cadence directions to match the card direction contract', () => {
    const broken = structuredClone(input);
    broken.card.reversible = true;
    expect(CardImportInputSchema.safeParse(broken).success).toBe(false);
  });
});
