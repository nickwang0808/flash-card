import { useLiveQuery } from '@tanstack/react-db';
import { getCardsCollection, type FlashCard } from '../services/collections';
import { useSettings } from './useSettings';

export type StudyItem = FlashCard & { isReverse: boolean };

export function useDeck(deckName: string) {
  const { settings } = useSettings();
  const newCardsLimit = settings.newCardsPerDay;

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const collection = getCardsCollection(deckName);
  const { data: cards, isLoading } = useLiveQuery(
    (q) => q.from({ cards: collection }),
    [deckName]
  );

  const newItems: StudyItem[] = [];
  const dueItems: StudyItem[] = [];

  for (const card of cards ?? []) {
    // Normal direction (source → translation)
    if (!card.state) {
      if (newItems.length < newCardsLimit) {
        newItems.push({ ...card, isReverse: false });
      }
    } else if (card.state.due <= endOfDay) {
      dueItems.push({ ...card, isReverse: false });
    }

    // Reverse direction (translation → source)
    if (card.reversible) {
      if (!card.reverseState) {
        if (newItems.length < newCardsLimit) {
          newItems.push({ ...card, isReverse: true });
        }
      } else if (card.reverseState.due <= endOfDay) {
        dueItems.push({ ...card, isReverse: true });
      }
    }
  }

  return {
    isLoading,
    newItems,
    dueItems,
    collection,
  };
}
