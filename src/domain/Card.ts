import { z } from 'zod';
import { CadenceStateFieldsSchema } from './CadenceState.ts';
import { TimestampSchema, UuidSchema } from './primitives.ts';

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

const CardIdentityAndContentSchema = z.object({
  id: UuidSchema,
  deckId: UuidSchema,
  name: CardNameSchema,
  frontMarkdown: MarkdownSchema,
  backMarkdown: MarkdownSchema,
  tags: z.array(z.string().trim().min(1).max(100)).max(100),
  speechText: z.string().trim().max(10_000).nullable(),
  speechLocale: z.string().trim().max(35).nullable(),
  suspended: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const CardSchema = CardIdentityAndContentSchema.and(CadenceStateFieldsSchema).superRefine((card, context) => {
  const isNew = card.cadencePhase === null && card.nextReviewAt === null && card.intervalDays === null && card.schedulerVersion === null;
  const isStudied = card.cadencePhase !== null && card.nextReviewAt !== null && card.intervalDays !== null && card.schedulerVersion !== null;
  if (!isNew && !isStudied) {
    context.addIssue({ code: 'custom', message: 'Cadence fields must be all null for new cards or all populated for studied cards' });
  }
});

export type CardContent = z.output<typeof CardContentSchema>;
export type Card = z.output<typeof CardSchema>;
