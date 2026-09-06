import { z } from 'zod';
import { TimestampSchema } from './primitives.ts';
import { CardCadenceSchema } from './Cadence.ts';

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
  reversible: z.boolean(),
});


export const CardSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().uuid(),
  name: CardNameSchema,
  frontMarkdown: MarkdownSchema,
  backMarkdown: MarkdownSchema,
  speechText: z.string().trim().max(10_000).nullable(),
  speechLocale: z.string().trim().max(35).nullable(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100),
  reversible: z.boolean(),
  suspended: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().nonnegative(),
  cadences: z.array(CardCadenceSchema),
});

export type CardContent = z.output<typeof CardContentSchema>;
export type Card = z.output<typeof CardSchema>;
