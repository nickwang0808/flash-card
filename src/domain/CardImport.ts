import { z } from 'zod';

import { CadenceDirectionSchema } from './Cadence.ts';
import { CadenceStateSchema, type CadenceState } from './CadenceState.ts';
import { CardContentSchema } from './Card.ts';
import { RatingSchema, TimestampSchema, UuidSchema } from './primitives.ts';

const ImportCardSchema = CardContentSchema.safeExtend({
  tags: z.array(z.string().trim().min(1).max(100)).max(100),
  suspended: z.boolean(),
}).strict();

const ImportReviewSchema = z.object({
  reviewedAt: TimestampSchema,
  rating: RatingSchema.nullable(),
  recalled: z.boolean().nullable(),
  durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  afterState: CadenceStateSchema,
}).strict().superRefine((review, context) => {
  if (review.rating === null && review.recalled === null) {
    context.addIssue({ code: 'custom', message: 'An imported review requires a rating or recall result' });
  }
  if (review.rating !== null && review.recalled !== null) {
    const expectedRecall = review.rating !== 'again';
    if (review.recalled !== expectedRecall) {
      context.addIssue({ code: 'custom', message: 'Rating and recall result disagree' });
    }
  }
  if (review.afterState.nextReviewAt !== null && Date.parse(review.afterState.nextReviewAt) <= Date.parse(review.reviewedAt)) {
    context.addIssue({ code: 'custom', message: 'An imported review must schedule a later due time', path: ['afterState', 'nextReviewAt'] });
  }
});

const ImportCadenceSchema = z.object({
  direction: CadenceDirectionSchema,
  baseState: CadenceStateSchema,
  reviews: z.array(ImportReviewSchema).max(10_000),
}).strict().superRefine((cadence, context) => {
  validateStateCounts(cadence.baseState, context, ['baseState']);
  let before = cadence.baseState;
  let previousReviewTime = Number.NEGATIVE_INFINITY;
  for (const [index, review] of cadence.reviews.entries()) {
    const reviewTime = Date.parse(review.reviewedAt);
    if (reviewTime < previousReviewTime) {
      context.addIssue({ code: 'custom', message: 'Imported reviews must be ordered oldest first', path: ['reviews', index, 'reviewedAt'] });
    }
    if (review.afterState.reviewCount !== before.reviewCount + 1) {
      context.addIssue({ code: 'custom', message: 'Each imported review must increment reviewCount by one', path: ['reviews', index, 'afterState', 'reviewCount'] });
    }
    if (review.afterState.lapseCount < before.lapseCount || review.afterState.lapseCount > before.lapseCount + 1) {
      context.addIssue({ code: 'custom', message: 'Each imported review may increment lapseCount by at most one', path: ['reviews', index, 'afterState', 'lapseCount'] });
    }
    validateStateCounts(review.afterState, context, ['reviews', index, 'afterState']);
    before = review.afterState;
    previousReviewTime = reviewTime;
  }
});

export const CardImportInputSchema = z.object({
  requestId: UuidSchema,
  deckId: UuidSchema,
  card: ImportCardSchema,
  cadences: z.array(ImportCadenceSchema).min(1).max(2),
}).strict().superRefine((input, context) => {
  const directions = input.cadences.map(({ direction }) => direction);
  if (new Set(directions).size !== directions.length) {
    context.addIssue({ code: 'custom', message: 'Imported cadence directions must be unique', path: ['cadences'] });
  }
  if (!directions.includes('forward')) {
    context.addIssue({ code: 'custom', message: 'An imported card requires a forward cadence', path: ['cadences'] });
  }
  if (directions.includes('reverse') !== input.card.reversible) {
    context.addIssue({ code: 'custom', message: 'Reverse cadence presence must match the reversible card setting', path: ['cadences'] });
  }
});

function validateStateCounts(state: CadenceState, context: z.RefinementCtx, path: PropertyKey[]) {
  if (state.lapseCount > state.reviewCount) {
    context.addIssue({ code: 'custom', message: 'lapseCount cannot exceed reviewCount', path });
  }
}

export type CardImportInput = z.output<typeof CardImportInputSchema>;
