import { z } from 'zod';

const SpeechTextSchema = z.string().trim().min(1).max(10_000);
export const SpeechSideSchema = z.enum(['front', 'back']);

export const SpeechLocaleSchema = z.string().trim().min(1).max(35).transform((value, context) => {
  try {
    const locale = Intl.getCanonicalLocales(value)[0];
    if (!locale) throw new RangeError('No canonical locale');
    return locale;
  } catch {
    context.addIssue({ code: 'custom', message: 'Speech locale must be a valid BCP 47 language tag' });
    return z.NEVER;
  }
});

export const CardSpeechFieldsSchema = z.object({
  speechText: SpeechTextSchema.nullable(),
  speechLocale: SpeechLocaleSchema.nullable(),
  speechSide: SpeechSideSchema.nullable(),
});

export function validateCardSpeechFields(value: z.output<typeof CardSpeechFieldsSchema>, context: z.RefinementCtx) {
  if (value.speechText === null && (value.speechLocale !== null || value.speechSide !== null)) {
    context.addIssue({ code: 'custom', message: 'Speech locale and side require speech text', path: ['speechText'] });
  }
  if (value.speechText !== null && value.speechSide === null) {
    context.addIssue({ code: 'custom', message: 'Speech side is required when speech text is configured', path: ['speechSide'] });
  }
}

export type SpeechLocale = z.output<typeof SpeechLocaleSchema>;
export type SpeechSide = z.output<typeof SpeechSideSchema>;
