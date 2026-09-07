import type { SpeechLocale, SpeechSide } from '@/domain/Speech';

export interface SpeechRequest {
  text: string;
  locale: SpeechLocale;
}

interface SpeechCard {
  speechText: string | null;
  speechLocale: SpeechLocale | null;
  speechSide: SpeechSide | null;
}

export function resolveSpeechRequest(card: SpeechCard, deckDefaultSpeechLocale: SpeechLocale | null): SpeechRequest | null {
  const locale = card.speechLocale ?? deckDefaultSpeechLocale;
  if (card.speechText === null || card.speechSide === null || locale === null) return null;
  return { text: card.speechText, locale };
}
