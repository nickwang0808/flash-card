import type { Card, CardContent } from '../../../../src/domain/Card.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import type { CardRevision } from '../../../../src/domain/CardRevision.ts';
import type { Deck } from '../../../../src/domain/Deck.ts';
import type { ReviewEvent, ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import type { CardRevisionRowDrizzle, CardRow, DeckRow, ReviewEventRowDrizzle } from '../../../../src/db/schema.ts';

/** Drizzle rows (camelCase keys, Date timestamps) to canonical domain records. */

export function mapDeckRow(row: DeckRow): Deck {
  return {
    id: row.id,
    name: row.name,
    defaultSpeechLocale: row.defaultSpeechLocale,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function mapCardRow(row: CardRow): Card {
  return {
    id: row.id,
    deckId: row.deckId,
    name: row.name,
    frontMarkdown: row.frontMarkdown,
    backMarkdown: row.backMarkdown,
    tags: row.tags,
    speechText: row.speechText,
    speechLocale: row.speechLocale,
    suspended: row.suspended,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cadencePhase: row.cadencePhase,
    nextReviewAt: row.nextReviewAt ? row.nextReviewAt.toISOString() : null,
    intervalDays: row.intervalDays,
    reviewCount: row.reviewCount,
    lapseCount: row.lapseCount,
    schedulerVersion: row.schedulerVersion,
    version: row.version,
  };
}

export function mapReviewEventRow(row: ReviewEventRowDrizzle): ReviewEvent {
  return {
    id: row.id,
    cardId: row.cardId,
    rating: row.rating,
    reviewedAt: row.reviewedAt.toISOString(),
    beforeState: row.beforeState,
    afterState: row.afterState,
    requestId: row.requestId,
    undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapHistoryEntryRow(row: ReviewEventRowDrizzle): ReviewHistoryEntry {
  const event = mapReviewEventRow(row);
  return {
    ...event,
    beforeIntervalDays: event.beforeState?.intervalDays ?? null,
    afterIntervalDays: event.afterState.intervalDays,
    resultingNextReviewAt: event.afterState.nextReviewAt,
  };
}

export function mapCardRevisionRow(row: CardRevisionRowDrizzle): CardRevision {
  return {
    id: row.id,
    cardId: row.cardId,
    eventType: row.eventType,
    beforeContent: row.beforeContent,
    afterContent: row.afterContent,
    createdAt: row.createdAt.toISOString(),
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

export type { CardContent };