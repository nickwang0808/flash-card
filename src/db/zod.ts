import { createSelectSchema } from 'drizzle-zod';
import { TimestampSchema } from '../domain/primitives.ts';
import { cardRevisions, cards, decks, reviewEvents } from './schema.ts';

/**
 * Generated Zod bases for the four authoritative tables. Each base mirrors
 * its Drizzle table; timestamp fields are overwritten with the domain ISO
 * 8601 TimestampSchema because the columns use `mode: 'date'`.
 *
 * This module imports only primitives: richer refinements (Markdown,
 * cadence consistency, content shapes) live in `src/domain/*` via `.extend()`
 * and `.superRefine()`, keeping the dependency direction db <- domain.
 */

export const deckBaseSchema = createSelectSchema(decks, {
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const cardBaseSchema = createSelectSchema(cards, {
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  nextReviewAt: TimestampSchema.nullable(),
});

export const reviewEventBaseSchema = createSelectSchema(reviewEvents, {
  reviewedAt: TimestampSchema,
  undoneAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export const cardRevisionBaseSchema = createSelectSchema(cardRevisions, {
  createdAt: TimestampSchema,
});
