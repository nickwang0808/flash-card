import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { STUDY_HORIZON_HOURS, StudyQueue, type QueueOptions } from '../../../src/domain/StudyQueue.ts';
import type { AppDb } from '../../../src/db/client.ts';
import { cardCadences, cards, decks } from '../../../src/db/schema.ts';

import { mapCadence, mapCard } from './card-aggregate.ts';

/** Reads a directional working set large enough to retain queue ordering after ratings. */
export async function queueSnapshot(
  db: AppDb,
  userId: string,
  deckId: string,
  options: QueueOptions,
  now: Date,
) {
  const horizon = new Date(now.getTime() + STUDY_HORIZON_HOURS * 3_600_000).toISOString();
  const rows = await db
    .select({
      card: cards,
      cadence: cardCadences,
      reviewCount: sql<number>`count(*) filter (where ${cardCadences.nextReviewAt} is not null) over ()`.mapWith(Number),
      newCount: sql<number>`count(*) filter (where ${cardCadences.nextReviewAt} is null) over ()`.mapWith(Number),
    })
    .from(cardCadences)
    .innerJoin(cards, eq(cards.id, cardCadences.cardId))
    .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)))
    .where(and(
      eq(cards.deckId, deckId),
      eq(cards.suspended, false),
      or(isNull(cardCadences.nextReviewAt), lte(cardCadences.nextReviewAt, horizon)),
    ))
    .orderBy(
      sql`case when ${cardCadences.nextReviewAt} is null then 1 else 0 end`,
      asc(cardCadences.nextReviewAt),
      sql`case ${cardCadences.direction} when 'forward' then 0 else 1 end`,
      asc(cards.createdAt),
      asc(cards.id),
      asc(cardCadences.id),
    )
    .limit(options.limit * 2);

  return new StudyQueue().build(
    rows
      .map(({ card, cadence }) => ({ card: mapCard(card), cadence: mapCadence(cadence) })),
    now,
    { review: rows[0]?.reviewCount ?? 0, new: rows[0]?.newCount ?? 0 },
    options,
  );
}
