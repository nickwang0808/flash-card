import { z } from 'zod';
import { ApplicationError } from './errors';
import { CardSchema } from './Card';
import type { Card } from './Card';
import { TimestampSchema } from './primitives';

export const QueueStatusSchema = z.enum(['new', 'due', 'future']);
export const QueueOptionsSchema = z.object({
  horizonHours: z.number().int().min(1).max(168).default(48),
  limit: z.number().int().min(1).max(100).default(50),
});
export const QueueCardSchema = CardSchema.and(z.object({ status: QueueStatusSchema }));
export const QueueSnapshotSchema = z.object({
  asOf: TimestampSchema,
  horizon: TimestampSchema,
  items: z.array(QueueCardSchema),
});

export type QueueOptions = z.output<typeof QueueOptionsSchema>;
export type QueueCard = z.output<typeof QueueCardSchema>;
export type QueueSnapshot = z.output<typeof QueueSnapshotSchema>;

const DEFAULT_QUEUE_OPTIONS: QueueOptions = Object.freeze({ horizonHours: 48, limit: 50 });

export class StudyQueue {
  build(cards: readonly Card[], now: Date, options: QueueOptions = DEFAULT_QUEUE_OPTIONS): QueueSnapshot {
    const asOfTime = now.getTime();
    if (!Number.isFinite(asOfTime)) {
      throw new ApplicationError('VALIDATION_FAILED', 'Queue time must be a valid date');
    }

    const queueOptions = QueueOptionsSchema.parse(options);
    const horizonTime = asOfTime + queueOptions.horizonHours * 3_600_000;
    const newCards = cards
      .filter((card) => !card.suspended && card.nextReviewAt === null)
      .sort((left, right) => this.compareTextThenId(left.createdAt, right.createdAt, left.id, right.id));
    const reviewedCards = cards
      .filter((card) => {
        if (card.suspended || card.nextReviewAt === null) return false;
        const nextReviewTime = Date.parse(card.nextReviewAt);
        return nextReviewTime <= horizonTime;
      })
      .sort((left, right) => this.compareTextThenId(left.nextReviewAt!, right.nextReviewAt!, left.id, right.id));

    const items = [...newCards.map((card) => ({ ...card, status: 'new' as const })), ...reviewedCards.map((card) => ({
      ...card,
      status: Date.parse(card.nextReviewAt!) <= asOfTime ? ('due' as const) : ('future' as const),
    }))].slice(0, queueOptions.limit);

    return Object.freeze({
      asOf: new Date(asOfTime).toISOString(),
      horizon: new Date(horizonTime).toISOString(),
      items,
    });
  }

  private compareTextThenId(leftTime: string, rightTime: string, leftId: string, rightId: string): number {
    const timeDifference = Date.parse(leftTime) - Date.parse(rightTime);
    return timeDifference !== 0 ? timeDifference : leftId.localeCompare(rightId);
  }
}
