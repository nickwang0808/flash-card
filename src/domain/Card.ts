import { z } from 'zod';
import { CardCadenceSchema } from './Cadence.ts';
import { CardSpeechFieldsSchema, validateCardSpeechFields } from './Speech.ts';
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
  ...CardSpeechFieldsSchema.shape,
  reversible: z.boolean(),
}).superRefine(validateCardSpeechFields);


export const CardBaseSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().uuid(),
  name: CardNameSchema,
  frontMarkdown: MarkdownSchema,
  backMarkdown: MarkdownSchema,
  ...CardSpeechFieldsSchema.shape,
  tags: z.array(z.string().trim().min(1).max(100)).max(100),
  reversible: z.boolean(),
  suspended: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().nonnegative(),
  cadences: z.array(CardCadenceSchema),
});

export const CardSchema = CardBaseSchema.superRefine(validateCardSpeechFields);

export type CardContent = z.output<typeof CardContentSchema>;
export type Card = z.output<typeof CardSchema>;
