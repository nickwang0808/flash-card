import type { SpeechSide } from '@/domain/Speech';

interface SpeechPlacementCard {
  speechSide: SpeechSide | null;
}

export function visibleSpeechSide(card: SpeechPlacementCard, canSpeak: boolean): SpeechSide | null {
  return canSpeak ? card.speechSide : null;
}
