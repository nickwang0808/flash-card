import { useLiveQuery } from '@tanstack/react-db';
import { useEffect } from 'react';
import { fsrs, createEmptyCard, type Grade, type Card, type ReviewLog, type Rating, type State } from 'ts-fsrs';
import { getCardsCollection, reviewLogsCollection, type FlashCard, type StoredReviewLog } from '../services/collections';
import { useSettings } from './useSettings';
import { parseCardState } from '../services/replication';
import { eq, type Collection } from '@tanstack/db';

// localStorage helpers for tracking introduced new cards
const STORAGE_KEY_PREFIX = 'flashcard:newCardsIntroduced:';

function getTodayKey(): string {
  return STORAGE_KEY_PREFIX + new Date().toISOString().split('T')[0];
}

export function getIntroducedToday(): Set<string> {
  const key = getTodayKey();
  const stored = localStorage.getItem(key);
  return new Set(stored ? JSON.parse(stored) : []);
}

export function markAsIntroduced(source: string): void {
  const key = getTodayKey();
  const introduced = getIntroducedToday();
  if (introduced.has(source)) return; // Already tracked
  introduced.add(source);
  localStorage.setItem(key, JSON.stringify([...introduced]));
}

// Run once on module load to clean up entries older than 3 days
function cleanupOldEntries(): void {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const cutoffDate = threeDaysAgo.toISOString().split('T')[0];

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      const dateStr = key.replace(STORAGE_KEY_PREFIX, '');
      if (dateStr < cutoffDate) {
        keysToRemove.push(key);
      }
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}

// Cleanup on load
cleanupOldEntries();

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

// Deserialize FSRS Card dates from ISO strings to Date objects
// RxDB stores JSON, so state.due and state.last_review come back as strings
function deserializeCardDates(card: FlashCard): FlashCard {
  return {
    ...card,
    state: card.state ? parseCardState(card.state as any) : null,
    reverseState: card.reverseState ? parseCardState(card.reverseState as any) : null,
  };
}

// Pure function to compute study items from cards
// Forward and reverse directions are kept separate to avoid showing them back-to-back
export function computeStudyItems(
  cards: FlashCard[],
  newCardsLimit: number,
  endOfDay: Date,
  introducedToday: Set<string> = new Set()
): { newItems: StudyItem[]; dueItems: StudyItem[] } {
  const newForward: StudyItem[] = [];
  const newReverse: StudyItem[] = [];
  const dueForward: StudyItem[] = [];
  const dueReverse: StudyItem[] = [];

  // Filter out suspended cards
  const activeCards = cards.filter(card => !card.suspended);

  // Count already-introduced cards toward limit
  const introducedCount = introducedToday.size;
  const remainingNewSlots = Math.max(0, newCardsLimit - introducedCount);
  let newSlotsUsed = 0;

  // First pass: collect forward directions
  for (const card of activeCards) {
    if (!card.state) {
      const isIntroduced = introducedToday.has(card.source);
      if (isIntroduced || newSlotsUsed < remainingNewSlots) {
        newForward.push({ ...card, isReverse: false });
        if (!isIntroduced) newSlotsUsed++;
      }
    } else if (card.state.due <= endOfDay) {
      dueForward.push({ ...card, isReverse: false });
    }
  }

  // Second pass: collect reverse directions
  for (const card of activeCards) {
    if (card.reversible) {
      const reverseKey = `${card.source}:reverse`;
      if (!card.reverseState) {
        const isIntroduced = introducedToday.has(reverseKey);
        if (isIntroduced || newSlotsUsed < remainingNewSlots) {
          newReverse.push({ ...card, isReverse: true });
          if (!isIntroduced) newSlotsUsed++;
        }
      } else if (card.reverseState.due <= endOfDay) {
        dueReverse.push({ ...card, isReverse: true });
      }
    }
  }

  // Combine: all forwards first, then all reverses
  return {
    newItems: [...newForward, ...newReverse],
    dueItems: [...dueForward, ...dueReverse],
  };
}

// Pure function to compute new FSRS state after rating
export function computeNewState(
  existingState: Card | null,
  rating: Grade,
  now: Date = new Date()
): { card: Card; log: ReviewLog } {
  const currentState: Card = existingState ?? createEmptyCard();
  const result = fsrs().repeat(currentState, now)[rating];
  return { card: result.card, log: result.log };
}

// Rate a card and update the collection
export function rateCard(
  cardsCollection: Collection<FlashCard, string>,
  logsCollection: Collection<StoredReviewLog, string>,
  card: StudyItem,
  rating: Grade
): void {
  const existingState = card.isReverse ? card.reverseState : card.state;
  const { card: newState, log } = computeNewState(existingState, rating);

  // Store ReviewLog for undo functionality
  const storedLog: StoredReviewLog = {
    id: `${card.source}:${card.isReverse ? 'reverse' : 'forward'}:${Date.now()}`,
    cardSource: card.source,
    isReverse: card.isReverse,
    rating: log.rating,
    state: log.state,
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    review: log.review.toISOString(),
  };
  logsCollection.insert(storedLog);

  // Update card using composite key
  cardsCollection.update(card.id, (draft) => {
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

  const collection = getCardsCollection();
  const { data: rawCards, isLoading: cardsLoading } = useLiveQuery(
    (q) => q.from({ cards: collection }).where(({ cards }) => eq(cards.deckName, deckName)),
    [deckName]
  );
  const { data: logs, isLoading: logsLoading } = useLiveQuery(
    (q) => q.from({ logs: reviewLogsCollection }),
    []
  );

  const isLoading = cardsLoading || logsLoading;

  const introducedToday = getIntroducedToday();
  // Deserialize FSRS dates from strings to Date objects
  const cardsList = (rawCards ?? []).map(deserializeCardDates);
  const logsList = logs ?? [];

  const { newItems, dueItems } = computeStudyItems(
    cardsList,
    newCardsLimit,
    endOfDay,
    introducedToday
  );

  // New cards first, then due cards
  const allItems = [...newItems, ...dueItems];
  const studyItem = allItems[0] ?? null;

  // Mark current card as introduced when first shown
  useEffect(() => {
    if (!studyItem) return;

    const isNew = studyItem.isReverse ? !studyItem.reverseState : !studyItem.state;
    if (!isNew) return;

    const key = studyItem.isReverse
      ? `${studyItem.source}:reverse`
      : studyItem.source;
    markAsIntroduced(key);
  }, [studyItem?.source, studyItem?.isReverse, studyItem?.state, studyItem?.reverseState]);

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
    rateCard(collection, reviewLogsCollection, studyItem, rating);
  }

  function suspend() {
    if (!studyItem) return;
    collection.update(studyItem.id, (draft) => {
      draft.suspended = true;
    });
  }

  function undo() {
    if (!studyItem) return;

    // Find the most recent log for this card+direction
    const relevantLogs = logsList
      .filter((l: StoredReviewLog) => l.cardSource === studyItem.source && l.isReverse === studyItem.isReverse)
      .sort((a: StoredReviewLog, b: StoredReviewLog) => parseInt(b.id.split(':')[2]) - parseInt(a.id.split(':')[2]));

    const lastLog = relevantLogs[0];
    if (!lastLog) return;

    const currentState = studyItem.isReverse ? studyItem.reverseState : studyItem.state;
    if (!currentState) return;

    // Convert stored log back to ReviewLog format for rollback
    const reviewLog: ReviewLog = {
      rating: lastLog.rating as Rating,
      state: lastLog.state as State,
      due: new Date(lastLog.due),
      stability: lastLog.stability,
      difficulty: lastLog.difficulty,
      elapsed_days: lastLog.elapsed_days,
      last_elapsed_days: lastLog.last_elapsed_days,
      scheduled_days: lastLog.scheduled_days,
      review: new Date(lastLog.review),
    };

    // Use FSRS rollback
    const previousState = fsrs().rollback(currentState, reviewLog);

    // Update card state using composite key
    collection.update(studyItem.id, (draft) => {
      if (studyItem.isReverse) {
        draft.reverseState = previousState;
      } else {
        draft.state = previousState;
      }
    });

    // Remove the log entry
    reviewLogsCollection.delete(lastLog.id);
  }

  // Check if undo is available for the current card
  const canUndo = studyItem
    ? logsList.some((l: StoredReviewLog) => l.cardSource === studyItem.source && l.isReverse === studyItem.isReverse)
    : false;

  return {
    isLoading,
    currentCard,
    remaining: allItems.length,
    rate,
    suspend,
    undo,
    canUndo,
    // Expose for testing/advanced use
    newItems,
    dueItems,
  };
}
