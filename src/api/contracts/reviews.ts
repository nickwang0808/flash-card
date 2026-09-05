import { z } from 'zod';
import { QueueOptionsSchema, QueueSnapshotSchema } from '../../domain/StudyQueue.ts';
import { RatingSchema, UuidSchema } from '../../domain/primitives.ts';
import { ReviewHistoryEntrySchema } from '../../domain/ReviewEvent.ts';
import { PaginationInputSchema, PageInfoSchema } from '../pagination.ts';
import { ExpectedVersionSchema, RequestIdSchema } from './common.ts';

export const ReviewRateInputSchema = z.object({
  cardId: UuidSchema,
  deckId: UuidSchema,
  rating: RatingSchema,
  expectedVersion: ExpectedVersionSchema,
  requestId: RequestIdSchema,
  queue: QueueOptionsSchema,
});
export const ReviewRateOutputSchema = z.object({ reviewId: UuidSchema, queue: QueueSnapshotSchema });
export const ReviewHistoryInputSchema = z.object({ cardId: UuidSchema, deckId: UuidSchema, pagination: PaginationInputSchema });
export const ReviewHistoryOutputSchema = z.object({ events: z.array(ReviewHistoryEntrySchema), pageInfo: PageInfoSchema });
export const ReviewUndoInputSchema = z.object({
  reviewId: UuidSchema,
  deckId: UuidSchema,
  queue: QueueOptionsSchema,
});
export const ReviewUndoOutputSchema = z.object({ queue: QueueSnapshotSchema });
