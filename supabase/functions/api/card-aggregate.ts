import type { CardCadence } from '../../../src/domain/Cadence.ts';
import type { Card } from '../../../src/domain/Card.ts';
import { toIsoTimestamp } from '../../../src/domain/primitives.ts';
import type { CardCadenceRow, CardRow } from '../../../src/db/schema.ts';

export function mapCadence(row: CardCadenceRow): CardCadence {
  return {
    id: row.id,
    cardId: row.cardId,
    direction: row.direction,
    nextReviewAt: row.nextReviewAt ? toIsoTimestamp(row.nextReviewAt) : null,
    intervalDays: row.intervalDays,
    reviewCount: row.reviewCount,
    lapseCount: row.lapseCount,
    version: row.version,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  };
}

export function mapCard(row: CardRow, cadences: readonly CardCadence[] = []): Card {
  return {
    id: row.id,
    deckId: row.deckId,
    name: row.name,
    frontMarkdown: row.frontMarkdown,
    backMarkdown: row.backMarkdown,
    speechText: row.speechText,
    speechLocale: row.speechLocale,
    speechSide: row.speechSide,
    tags: row.tags,
    reversible: row.reversible,
    suspended: row.suspended,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    version: row.version,
    cadences: [...cadences],
  };
}
