import { z } from 'zod';

export const PaginationInputSchema = z.object({
  cursor: z.string().min(1).max(500).nullable().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const PageInfoSchema = z.object({
  nextCursor: z.string().min(1).max(500).nullable(),
});

export type PaginationInput = z.output<typeof PaginationInputSchema>;
export type PageInfo = z.output<typeof PageInfoSchema>;
