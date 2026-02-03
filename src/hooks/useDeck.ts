import {useLiveQuery} from '@tanstack/react-db';
import {eq, lte} from '@tanstack/db';
import { type Card } from 'ts-fsrs';
import {
  cardsCollection,
  cardStatesCollection,
} from '../services/collections';
import {settingsStore} from '../services/settings-store';

export interface StudiableCard {
  id: string; // Full id (e.g., "deckName/cardId" or "deckName/cardId:reverse")
  cardId: string; // Just the cardId part (e.g., "hola" or "hola:reverse")
  deckName: string;
  front: string;
  back: string;
  example?: string;
  notes?: string;
  state: Card | null; // null for new cards
  isNew: boolean;
  isReverse: boolean;
  due: Date | null;
}

export function useDeck(deckName: string) {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const settings = settingsStore.get();
  const newCardsLimit = settings.newCardsPerDay;

  // Query 1: All cards for this deck
  const {data: cards, isLoading: cardsLoading} = useLiveQuery(
    (q) =>
      q
        .from({cards: cardsCollection})
        .where(({cards}) => eq(cards.deckName, deckName)),
    [deckName]
  );

  // Query 2: States due today for this deck
  const {data: dueStates, isLoading: statesLoading} = useLiveQuery(
    (q) =>
      q
        .from({states: cardStatesCollection})
        .where(({states}) => eq(states.deckName, deckName))
        .where(({states}) => lte(states.state.due, endOfDay)),
    [deckName, endOfDay.getTime()]
  );

  const isLoading = cardsLoading || statesLoading;

  // Cards with a due state (normal or reverse)
  const dueCardIds = new Set(
    dueStates?.map((s) => s.id.replace(/:reverse$/, '')) ?? []
  );

  // New cards: no state exists for this card (neither normal nor reverse)
  const newCards = (cards ?? []).filter((c) => !dueCardIds.has(c.id)).slice(0, newCardsLimit);

  // Map due states to studiable cards (handles both normal and reverse)
  const dueStudiable = (dueStates ?? []).map((s): StudiableCard => {
    const isReverse = s.id.endsWith(':reverse');
    const baseCardId = s.id.replace(/:reverse$/, '');
    const card = cards?.find((c) => c.id === baseCardId);

    return {
      id: s.id,
      cardId: s.cardId,
      deckName: s.deckName,
      front: isReverse ? (card?.translation ?? '') : (card?.source ?? ''),
      back: isReverse ? (card?.source ?? '') : (card?.translation ?? ''),
      example: card?.example,
      notes: card?.notes,
      state: s.state,
      isNew: false,
      isReverse,
      due: s.state.due,
    };
  });

  // Map new cards + create reverse entries for reversible cards
  const newStudiable = newCards.flatMap((c): StudiableCard[] => {
    const card = c;
    const cardIdOnly = card.id.split('/')[1]; // Extract cardId from "deckName/cardId"
    const normal: StudiableCard = {
      id: card.id,
      cardId: cardIdOnly,
      deckName: card.deckName,
      front: card.source,
      back: card.translation,
      example: card.example,
      notes: card.notes,
      state: null,
      isNew: true,
      isReverse: false,
      due: null,
    };

    if (card.reversible) {
      const reverse: StudiableCard = {
        id: `${card.id}:reverse`,
        cardId: `${cardIdOnly}:reverse`,
        deckName: card.deckName,
        front: card.translation,
        back: card.source,
        example: card.example,
        notes: card.notes,
        state: null,
        isNew: true,
        isReverse: true,
        due: null,
      };
      return [normal, reverse];
    }

    return [normal];
  });

  const studiableCards = [...newStudiable, ...dueStudiable];
  const currentCard = studiableCards[0] ?? null;

  return {
    isLoading,
    studiableCards,
    // For ReviewScreen
    currentCard,
    deck: studiableCards,
    // For DeckListScreen
    newRemaining: newStudiable.length,
    dueRemaining: dueStudiable.length,
  };
}
