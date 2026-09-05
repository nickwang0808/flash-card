import type { CadenceState } from '../domain/CadenceState.ts';
import type { CardContent } from '../domain/Card.ts';

import { pgTable, pgSchema, uuid, text, timestamp, boolean, integer, doublePrecision, jsonb, index, unique, check, pgPolicy } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Drizzle view of the authoritative Postgres schema. The SQL migration is
 * canonical; tenant-scoped procedures query through these typed builders.
 */

export const decks = pgTable(
  'decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    defaultSpeechLocale: text('default_speech_locale'),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(0),
  },
  (table) => [
    unique('decks_user_id_name_key').on(table.userId, table.name),
    index('decks_user_id_idx').on(table.userId),
    check('decks_version_check', sql`${table.version} >= 0`),
    pgPolicy('decks select own', { as: 'permissive', for: 'select', to: 'authenticated', using: sql`user_id = auth.uid()` }),
    pgPolicy('decks insert own', { as: 'permissive', for: 'insert', to: 'authenticated', withCheck: sql`user_id = auth.uid()` }),
    pgPolicy('decks update own', { as: 'permissive', for: 'update', to: 'authenticated', using: sql`user_id = auth.uid()` }),
    pgPolicy('decks delete own', { as: 'permissive', for: 'delete', to: 'authenticated', using: sql`user_id = auth.uid()` }),
  ],
);

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deckId: uuid('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    frontMarkdown: text('front_markdown').notNull(),
    backMarkdown: text('back_markdown').notNull(),
    speechText: text('speech_text'),
    speechLocale: text('speech_locale'),
    tags: text('tags').array().notNull().default([]),
    suspended: boolean('suspended').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
    nextReviewAt: timestamp('next_review_at', { mode: 'string', withTimezone: true }),
    intervalDays: doublePrecision('interval_days'),
    reviewCount: integer('review_count').notNull().default(0),
    lapseCount: integer('lapse_count').notNull().default(0),
    version: integer('version').notNull().default(0),
  },
  (table) => [
    index('cards_deck_id_idx').on(table.deckId),
    index('cards_new_order_idx').on(table.deckId, table.createdAt, table.id).where(sql`next_review_at is null and not suspended`),
    index('cards_review_order_idx').on(table.deckId, table.nextReviewAt, table.id).where(sql`next_review_at is not null and not suspended`),
    check('cards_name_check', sql`btrim(${table.name}) <> ''`),
    check('cards_interval_days_check', sql`${table.intervalDays} is null or ${table.intervalDays} > 0`),
    check('cards_review_count_check', sql`${table.reviewCount} >= 0`),
    check('cards_lapse_count_check', sql`${table.lapseCount} >= 0`),
    check('scheduling_fields_all_or_none', sql`(${table.nextReviewAt} is null and ${table.intervalDays} is null) or (${table.nextReviewAt} is not null and ${table.intervalDays} is not null)`),
    pgPolicy('cards select own', { as: 'permissive', for: 'select', to: 'authenticated', using: sql`exists (select 1 from decks where decks.id = ${table.deckId} and decks.user_id = auth.uid())` }),
    pgPolicy('cards insert own', { as: 'permissive', for: 'insert', to: 'authenticated', withCheck: sql`exists (select 1 from decks where decks.id = ${table.deckId} and decks.user_id = auth.uid())` }),
    pgPolicy('cards update own', { as: 'permissive', for: 'update', to: 'authenticated', using: sql`exists (select 1 from decks where decks.id = ${table.deckId} and decks.user_id = auth.uid())` }),
    pgPolicy('cards delete own', { as: 'permissive', for: 'delete', to: 'authenticated', using: sql`exists (select 1 from decks where decks.id = ${table.deckId} and decks.user_id = auth.uid())` }),
  ],
);

export const reviewEvents = pgTable(
  'review_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
    rating: text('rating', { enum: ['again', 'hard', 'good', 'easy'] }).notNull(),
    reviewedAt: timestamp('reviewed_at', { mode: 'string', withTimezone: true }).notNull(),
    beforeState: jsonb('before_state').$type<CadenceState | null>(),
    afterState: jsonb('after_state').$type<CadenceState>().notNull(),
    requestId: uuid('request_id').notNull(),
    undoneAt: timestamp('undone_at', { mode: 'string', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('review_events_card_id_request_id_key').on(table.cardId, table.requestId),
    index('review_events_card_reviewed_idx').on(table.cardId, table.reviewedAt.asc(), table.id),
    check('review_events_rating_check', sql`${table.rating} in ('again', 'hard', 'good', 'easy')`),
    pgPolicy('review_events select own', { as: 'permissive', for: 'select', to: 'authenticated', using: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
    pgPolicy('review_events insert own', { as: 'permissive', for: 'insert', to: 'authenticated', withCheck: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
    pgPolicy('review_events update own', { as: 'permissive', for: 'update', to: 'authenticated', using: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
    pgPolicy('review_events delete own', { as: 'permissive', for: 'delete', to: 'authenticated', using: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
  ],
);

export const cardRevisions = pgTable(
  'card_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
    eventType: text('event_type', { enum: ['created', 'edited', 'restored', 'ai_generated'] }).notNull(),
    beforeContent: jsonb('before_content').$type<CardContent | null>(),
    afterContent: jsonb('after_content').$type<CardContent>().notNull(),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('card_revisions_card_created_idx').on(table.cardId, table.createdAt.desc(), table.id),
    check('card_revisions_event_type_check', sql`${table.eventType} in ('created', 'edited', 'restored', 'ai_generated')`),
    pgPolicy('card_revisions select own', { as: 'permissive', for: 'select', to: 'authenticated', using: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
    pgPolicy('card_revisions insert own', { as: 'permissive', for: 'insert', to: 'authenticated', withCheck: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
    pgPolicy('card_revisions update own', { as: 'permissive', for: 'update', to: 'authenticated', using: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
    pgPolicy('card_revisions delete own', { as: 'permissive', for: 'delete', to: 'authenticated', using: sql`exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = ${table.cardId})` }),
  ],
);

/**
 * `auth.users` lives in the `auth` schema (outside migrations).
 * Declared via pgSchema so the deck FK references the real two-part name.
 */
const auth = pgSchema('auth');

export const authUsers = auth.table('users', {
  id: uuid('id').primaryKey(),
});

/** Enable RLS on the four tenant tables; the policies above are defense in depth. */
export const enableRls = () =>
  sql`
    alter table public.decks enable row level security;
    alter table public.cards enable row level security;
    alter table public.review_events enable row level security;
    alter table public.card_revisions enable row level security;
  `;

export type DeckRow = typeof decks.$inferSelect;
export type NewDeckRow = typeof decks.$inferInsert;
export type CardRow = typeof cards.$inferSelect;
export type NewCardRow = typeof cards.$inferInsert;
export type ReviewEventRowDrizzle = typeof reviewEvents.$inferSelect;
export type NewReviewEventRow = typeof reviewEvents.$inferInsert;
export type CardRevisionRowDrizzle = typeof cardRevisions.$inferSelect;
export type NewCardRevisionRow = typeof cardRevisions.$inferInsert;

export const schema = { decks, cards, reviewEvents, cardRevisions, authUsers };