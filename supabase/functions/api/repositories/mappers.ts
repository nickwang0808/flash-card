import type { Card, CardContent } from '../../../../src/domain/Card.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import type { CardRevision } from '../../../../src/domain/CardRevision.ts';
import type { Deck } from '../../../../src/domain/Deck.ts';
import type { ReviewEvent, ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import type { Rating } from '../../../../src/domain/primitives.ts';

/** snake_case Postgres rows, mapped to canonical camelCase records here only. */

export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  default_speech_locale: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

export function mapDeckRow(row: DeckRow): Deck {
  return {
    id: row.id,
    name: row.name,
    defaultSpeechLocale: row.default_speech_locale,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

export interface CardRow {
  id: string;
  deck_id: string;
  name: string;
  front_markdown: string;
  back_markdown: string;
  speech_text: string | null;
  speech_locale: string | null;
  tags: string[];
  suspended: boolean;
  created_at: Date;
  updated_at: Date;
  cadence_phase: 'learning' | 'review' | null;
  next_review_at: Date | null;
  interval_days: number | null;
  review_count: number;
  lapse_count: number;
  scheduler_version: number | null;
  version: number;
}

export function mapCardRow(row: CardRow): Card {
  return {
    id: row.id,
    deckId: row.deck_id,
    name: row.name,
    frontMarkdown: row.front_markdown,
    backMarkdown: row.back_markdown,
    tags: row.tags,
    speechText: row.speech_text,
    speechLocale: row.speech_locale,
    suspended: row.suspended,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    cadencePhase: row.cadence_phase,
    nextReviewAt: row.next_review_at ? row.next_review_at.toISOString() : null,
    intervalDays: row.interval_days,
    reviewCount: row.review_count,
    lapseCount: row.lapse_count,
    schedulerVersion: row.scheduler_version,
    version: row.version,
  };
}

export interface ReviewEventRow {
  id: string;
  card_id: string;
  rating: Rating;
  reviewed_at: Date;
  before_state: CadenceState | null;
  after_state: CadenceState;
  request_id: string;
  undone_at: Date | null;
  created_at: Date;
}

export function mapReviewEventRow(row: ReviewEventRow): ReviewEvent {
  return {
    id: row.id,
    cardId: row.card_id,
    rating: row.rating,
    reviewedAt: row.reviewed_at.toISOString(),
    beforeState: row.before_state,
    afterState: row.after_state,
    requestId: row.request_id,
    undoneAt: row.undone_at ? row.undone_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function mapHistoryEntryRow(row: ReviewEventRow): ReviewHistoryEntry {
  const event = mapReviewEventRow(row);
  return {
    ...event,
    beforeIntervalDays: event.beforeState?.intervalDays ?? null,
    afterIntervalDays: event.afterState.intervalDays,
    resultingNextReviewAt: event.afterState.nextReviewAt,
  };
}

export interface CardRevisionRow {
  id: string;
  card_id: string;
  event_type: 'created' | 'edited' | 'restored' | 'ai_generated';
  before_content: CardContent | null;
  after_content: CardContent;
  created_at: Date;
}

export function mapCardRevisionRow(row: CardRevisionRow): CardRevision {
  return {
    id: row.id,
    cardId: row.card_id,
    eventType: row.event_type,
    beforeContent: row.before_content,
    afterContent: row.after_content,
    createdAt: row.created_at.toISOString(),
  };
}

/** The all-null state of a brand-new card, stored as JSON so undo can restore it exactly. */
export function newCardState(): CadenceState {
  return {
    cadencePhase: null,
    nextReviewAt: null,
    intervalDays: null,
    reviewCount: 0,
    lapseCount: 0,
    schedulerVersion: null,
  };
}