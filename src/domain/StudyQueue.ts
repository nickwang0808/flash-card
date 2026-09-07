import { z } from 'zod';

import { CardCadenceSchema, type CardCadence } from './Cadence.ts';
import { CardBaseSchema, type Card } from './Card.ts';
import { validateCardSpeechFields } from './Speech.ts';
import { ApplicationError } from './errors.ts';
import { TimestampSchema } from './primitives.ts';

export const STUDY_HORIZON_HOURS = 12;

const QueueStatusSchema = z.enum(['new', 'due', 'future']);
export const QueueOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});
const QueueCountsSchema = z.object({
  review: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
});
const QueueCardSchema = CardBaseSchema.omit({ cadences: true }).extend({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  direction: CardCadenceSchema.shape.direction,
  nextReviewAt: CardCadenceSchema.shape.nextReviewAt,
  intervalDays: CardCadenceSchema.shape.intervalDays,
  reviewCount: CardCadenceSchema.shape.reviewCount,
  lapseCount: CardCadenceSchema.shape.lapseCount,
  version: CardCadenceSchema.shape.version,
  status: QueueStatusSchema,
}).superRefine(validateCardSpeechFields);
export const QueueSnapshotSchema = z.object({
  asOf: TimestampSchema,
  horizon: TimestampSchema,
  counts: QueueCountsSchema,
  items: z.array(QueueCardSchema),
});

export type QueueOptions = z.output<typeof QueueOptionsSchema>;
export type QueueItem = z.output<typeof QueueCardSchema>;
export type QueueCounts = z.output<typeof QueueCountsSchema>;
export type QueueSnapshot = z.output<typeof QueueSnapshotSchema>;
export interface StudyQueueCandidate {
  card: Card;
  cadence: CardCadence;
}

const DEFAULT_QUEUE_OPTIONS: QueueOptions = Object.freeze({ limit: 50 });

export class StudyQueue {
  build(candidates: readonly StudyQueueCandidate[], now: Date, counts: QueueCounts, options: QueueOptions = DEFAULT_QUEUE_OPTIONS): QueueSnapshot {
    const asOfTime = now.getTime();
    if (!Number.isFinite(asOfTime)) {
      throw new ApplicationError('VALIDATION_FAILED', 'Queue time must be a valid date');
    }

    const queueCounts = QueueCountsSchema.parse(counts);
    const queueOptions = QueueOptionsSchema.parse(options);
    const horizonTime = asOfTime + STUDY_HORIZON_HOURS * 3_600_000;
    const eligible = candidates.filter(({ card, cadence }) => !card.suspended && (cadence.nextReviewAt === null || Date.parse(cadence.nextReviewAt) <= horizonTime));
    const studied = eligible
      .filter(({ cadence }) => cadence.nextReviewAt !== null)
      .sort((left, right) => this.compareStudied(left, right));
    const fresh = eligible
      .filter(({ cadence }) => cadence.nextReviewAt === null)
      .sort((left, right) => this.compareNew(left, right));

    const items: QueueItem[] = [...studied, ...fresh].slice(0, queueOptions.limit).map(({ card, cadence }) => ({
      id: cadence.id,
      cardId: card.id,
      deckId: card.deckId,
      name: card.name,
      frontMarkdown: cadence.direction === 'forward' ? card.frontMarkdown : card.backMarkdown,
      backMarkdown: cadence.direction === 'forward' ? card.backMarkdown : card.frontMarkdown,
      speechText: card.speechText,
      speechLocale: card.speechLocale,
      speechSide: cadence.direction === 'forward' ? card.speechSide : card.speechSide === 'front' ? 'back' : card.speechSide === 'back' ? 'front' : null,
      tags: card.tags,
      reversible: card.reversible,
      suspended: card.suspended,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      direction: cadence.direction,
      nextReviewAt: cadence.nextReviewAt,
      intervalDays: cadence.intervalDays,
      reviewCount: cadence.reviewCount,
      lapseCount: cadence.lapseCount,
      version: cadence.version,
      status: cadence.nextReviewAt === null ? 'new' : Date.parse(cadence.nextReviewAt) <= asOfTime ? 'due' : 'future',
    }));

    return Object.freeze({
      asOf: new Date(asOfTime).toISOString(),
      horizon: new Date(horizonTime).toISOString(),
      counts: queueCounts,
      items,
    });
  }

  private compareStudied(left: StudyQueueCandidate, right: StudyQueueCandidate): number {
    const dueDifference = Date.parse(left.cadence.nextReviewAt!) - Date.parse(right.cadence.nextReviewAt!);
    return dueDifference || left.card.id.localeCompare(right.card.id) || left.cadence.direction.localeCompare(right.cadence.direction) || left.cadence.id.localeCompare(right.cadence.id);
  }

  private compareNew(left: StudyQueueCandidate, right: StudyQueueCandidate): number {
    const directionDifference = this.directionRank(left.cadence.direction) - this.directionRank(right.cadence.direction);
    return directionDifference || this.compareTextThenId(left.card.createdAt, right.card.createdAt, left.card.id, right.card.id) || left.cadence.id.localeCompare(right.cadence.id);
  }

  private directionRank(direction: CardCadence['direction']): number {
    return direction === 'forward' ? 0 : 1;
  }

  private compareTextThenId(leftTime: string, rightTime: string, leftId: string, rightId: string): number {
    const timeDifference = Date.parse(leftTime) - Date.parse(rightTime);
    return timeDifference !== 0 ? timeDifference : leftId.localeCompare(rightId);
  }
}
