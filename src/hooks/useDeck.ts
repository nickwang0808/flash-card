import { useLiveQuery } from '@tanstack/react-db';
import { getCardsCollection, type FlashCard } from '../services/collections';
import { settingsStore } from '../services/settings-store';

export type StudyItem = FlashCard & { isReverse: boolean };

export function useDeck(deckName: string) {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const settings = settingsStore.get();
  const newCardsLimit = settings.newCardsPerDay;

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
