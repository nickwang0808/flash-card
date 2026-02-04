import { useLiveQuery } from '@tanstack/react-db';
import { fsrs, createEmptyCard, type Grade, type Card } from 'ts-fsrs';
import { getCardsCollection, type FlashCard } from '../services/collections';
import { useSettings } from './useSettings';
import type { Collection } from '@tanstack/db';

export type StudyItem = FlashCard & { isReverse: boolean };

export interface CurrentCard {
  source: string;
  front: string;
  back: string;
  example?: string;
  notes?: string;
  isReverse: boolean;
  isNew: boolean;
}

// Pure function to compute study items from cards
export function computeStudyItems(
  cards: FlashCard[],
  newCardsLimit: number,
  endOfDay: Date
): { newItems: StudyItem[]; dueItems: StudyItem[] } {
  const newItems: StudyItem[] = [];
  const dueItems: StudyItem[] = [];

  for (const card of cards) {
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

  return { newItems, dueItems };
}

// Pure function to compute new FSRS state after rating
export function computeNewState(
  existingState: Card | null,
  rating: Grade,
  now: Date = new Date()
): Card {
  const currentState: Card = existingState ?? createEmptyCard();
  return fsrs().repeat(currentState, now)[rating].card;
}

// Rate a card and update the collection
export function rateCard(
  collection: Collection<FlashCard, string>,
  card: StudyItem,
  rating: Grade
): void {
  const existingState = card.isReverse ? card.reverseState : card.state;
  const newState = computeNewState(existingState, rating);

  collection.update(card.source, (draft) => {
    if (card.isReverse) {
      draft.reverseState = newState;
    } else {
      draft.state = newState;
    }
  });
}

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

  const { newItems, dueItems } = computeStudyItems(
    cards ?? [],
    newCardsLimit,
    endOfDay
  );

  // New cards first, then due cards
  const allItems = [...newItems, ...dueItems];
  const studyItem = allItems[0] ?? null;

  // Compute current card display info
  const currentCard: CurrentCard | null = studyItem
    ? {
        source: studyItem.source,
        front: studyItem.isReverse ? studyItem.translation : studyItem.source,
        back: studyItem.isReverse ? studyItem.source : studyItem.translation,
        example: studyItem.example,
        notes: studyItem.notes,
        isReverse: studyItem.isReverse,
        isNew: studyItem.isReverse ? !studyItem.reverseState : !studyItem.state,
      }
    : null;

  function rate(rating: Grade) {
    if (!studyItem) return;
    rateCard(collection, studyItem, rating);
  }

  return {
    isLoading,
    currentCard,
    remaining: allItems.length,
    rate,
    // Expose for testing/advanced use
    newItems,
    dueItems,
  };
}
