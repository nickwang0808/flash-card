import { z } from 'zod';
import { TimestampSchema } from './primitives.ts';

export const MarkdownSchema = z
  .string()
  .trim()
  .min(1)
  .max(50_000)
  .refine(
    (value) => {
      const tags = value.match(/<\/?[A-Za-z][^>]*>/g) ?? [];
      return tags.every((tag) => /^<\/?(?:ruby|rt|rp)>$/.test(tag));
    },
    'Only ruby, rt, and rp HTML tags are allowed in Markdown',
  );

export const CardNameSchema = z.string().trim().min(1).max(200);

export const CardContentSchema = z.object({
  name: CardNameSchema,
  frontMarkdown: MarkdownSchema,
  backMarkdown: MarkdownSchema,
  speechText: z.string().trim().max(10_000).nullable(),
  speechLocale: z.string().trim().max(35).nullable(),
});

const CadenceFields = {
  nextReviewAt: TimestampSchema.nullable(),
  intervalDays: z.number().finite().positive().nullable(),
  reviewCount: z.number().int().nonnegative(),
  lapseCount: z.number().int().nonnegative(),
};

function withCadenceRefinement<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((card, context) => {
    const value = card as { nextReviewAt: string | null; intervalDays: number | null };
    const isNew = value.nextReviewAt === null && value.intervalDays === null;
    const isStudied = value.nextReviewAt !== null && value.intervalDays !== null;
    if (!isNew && !isStudied) {
      context.addIssue({ code: 'custom', message: 'Scheduling fields must be all null for new cards or all populated for studied cards' });
    }
  });
}

export const CardSchema = withCadenceRefinement(z.object({
  id: z.string().uuid(),
  deckId: z.string().uuid(),
  name: CardNameSchema,
  frontMarkdown: MarkdownSchema,
  backMarkdown: MarkdownSchema,
  speechText: z.string().trim().max(10_000).nullable(),
  speechLocale: z.string().trim().max(35).nullable(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100),
  suspended: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  ...CadenceFields,
  version: z.number().int().nonnegative(),
}));

export type CardContent = z.output<typeof CardContentSchema>;
export type Card = z.output<typeof CardSchema>;
