import { useLiveQuery } from '@tanstack/react-db';
import { eq, lte } from '@tanstack/db';
import {
  cardsCollection,
  cardStatesCollection,
} from '../services/collections';
import { type CardState } from '../utils/fsrs';
import { settingsStore } from '../services/settings-store';

export interface ReviewableCard {
  id: string; // Full id: "deckName/cardId" or "deckName/cardId:reverse"
  cardId: string; // Just the cardId part (e.g., "hola" or "hola:reverse")
  deckName: string;
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  isReverse: boolean;
  isNew: boolean;
  state: CardState | null; // null for new cards
  due: Date | null; // null for new cards (always due)
}

interface UseDeckResult {
  deck: ReviewableCard[];
  currentCard: ReviewableCard | null;
  isLoading: boolean;
  newRemaining: number;
  dueRemaining: number;
}

export function useDeck(deckName: string): UseDeckResult {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const endOfDayStr = endOfDay.toISOString();

  const now = new Date();

  const settings = settingsStore.get();
  const newCardsLimit = settings.newCardsPerDay;

  // Query 1: All cards for this deck
  const { data: allCards, isLoading: cardsLoading } = useLiveQuery(
    (q) =>
      q
        .from({ cards: cardsCollection })
        .where(({ cards }) => eq(cards.deckName, deckName)),
    [deckName],
  );

  // Query 2: States due today for this deck
  const { data: dueStates, isLoading: statesLoading } = useLiveQuery(
    (q) =>
      q
        .from({ states: cardStatesCollection })
        .where(({ states }) => eq(states.deckName, deckName))
        .where(({ states }) => lte(states.state.due, endOfDayStr)),
    [deckName, endOfDayStr],
  );

  const isLoading = cardsLoading || statesLoading;

  // Build a set of card IDs that have state entries due today
  const stateMap = new Map<string, CardState>();
  if (dueStates) {
    for (const stateRow of dueStates) {
      stateMap.set(stateRow.id, stateRow.state);
    }
  }

  // Build reviewable cards list
  const reviewableCards: ReviewableCard[] = [];

  if (allCards) {
    for (const card of allCards) {
      const cardId = card.id.split('/')[1];

      // Check if this card has a state entry (due today)
      const state = stateMap.get(card.id);
      if (state) {
        // Card with state due today
        const due = new Date(state.due);
        reviewableCards.push({
          id: card.id,
          cardId,
          deckName: card.deckName,
          source: card.source,
          translation: card.translation,
          example: card.example,
          notes: card.notes,
          isReverse: false,
          isNew: false,
          state,
          due,
        });
      } else if (!cardStatesCollection.get(card.id)) {
        // Card with NO state entry at all = new card
        reviewableCards.push({
          id: card.id,
          cardId,
          deckName: card.deckName,
          source: card.source,
          translation: card.translation,
          example: card.example,
          notes: card.notes,
          isReverse: false,
          isNew: true,
          state: null,
          due: null,
        });
      }
      // else: card has state but not due today - skip

      // Handle reverse card if reversible
      if (card.reversible) {
        const reverseId = `${card.id}:reverse`;
        const reverseState = stateMap.get(reverseId);

        if (reverseState) {
          // Reverse card with state due today
          const reverseDue = new Date(reverseState.due);
          reviewableCards.push({
            id: reverseId,
            cardId: `${cardId}:reverse`,
            deckName: card.deckName,
            source: card.translation,
            translation: card.source,
            example: card.example,
            notes: card.notes,
            isReverse: true,
            isNew: false,
            state: reverseState,
            due: reverseDue,
          });
        } else if (!cardStatesCollection.get(reverseId)) {
          // Reverse card with NO state = new
          reviewableCards.push({
            id: reverseId,
            cardId: `${cardId}:reverse`,
            deckName: card.deckName,
            source: card.translation,
            translation: card.source,
            example: card.example,
            notes: card.notes,
            isReverse: true,
            isNew: true,
            state: null,
            due: null,
          });
        }
      }
    }
  }

  // Sort: due cards by due date, then new cards
  reviewableCards.sort((a, b) => {
    // Due cards first (sorted by due date), then new cards
    if (!a.isNew && b.isNew) return -1;
    if (a.isNew && !b.isNew) return 1;
    if (a.due && b.due) return a.due.getTime() - b.due.getTime();
    return 0;
  });

  // Limit new cards
  let newCount = 0;
  const limitedCards = reviewableCards.filter((card) => {
    if (card.isNew) {
      newCount++;
      return newCount <= newCardsLimit;
    }
    return true;
  });

  // Cards that are due RIGHT NOW (new cards are always due, others check due <= now)
  const dueNow = limitedCards.filter((c) => c.isNew || (c.due && c.due <= now));

  return {
    deck: limitedCards,
    currentCard: dueNow[0] ?? null,
    isLoading,
    newRemaining: dueNow.filter((c) => c.isNew).length,
    dueRemaining: dueNow.filter((c) => !c.isNew).length,
  };
}
