import { z } from 'zod';
import { QueueSnapshotSchema } from '../../domain/StudyQueue.ts';
import { UuidSchema } from '../../domain/primitives.ts';

export const ExpectedVersionSchema = z.number().int().nonnegative();
export const ReplacementQueueSchema = z.object({ queue: QueueSnapshotSchema });
export const ConfirmationSchema = z.literal(true);
export const RequestIdSchema = UuidSchema;
