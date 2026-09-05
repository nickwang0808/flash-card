import { z } from 'zod';
import { QueueOptionsSchema, QueueSnapshotSchema } from '../../domain/StudyQueue';
import { RatingSchema, UuidSchema } from '../../domain/primitives';
import { ReviewHistoryEntrySchema } from '../../domain/ReviewEvent';
import { PaginationInputSchema, PageInfoSchema } from '../pagination';
import { ExpectedVersionSchema, RequestIdSchema } from './common';

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
