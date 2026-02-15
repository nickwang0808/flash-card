import { fsrs, createEmptyCard, type Grade, type Card, type ReviewLog, type Rating, type State } from 'ts-fsrs';
import { type FlashCard, useCards, getCardRepository, serializeFsrsCard } from '../services/card-repository';
import { type StoredReviewLog, useReviewLogs, getReviewLogRepository } from '../services/review-log-repository';
import { useSettings } from './useSettings';
import { notifyChange } from '../services/replication';

export type StudyItem = FlashCard & { isReverse: boolean };

interface CurrentCard {
  source: string;
  front: string;
  back: string;
  example?: string;
  notes?: string;
  isReverse: boolean;
  isNew: boolean;
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
  // Sort due items by due time so recently-rated learning cards fall to the end
  return {
    newItems: [...newForward, ...newReverse],
    dueItems: [...dueForward, ...dueReverse].sort((a, b) => {
      const aDue = a.isReverse ? a.reverseState!.due : a.state!.due;
      const bDue = b.isReverse ? b.reverseState!.due : b.state!.due;
      return aDue.getTime() - bDue.getTime();
    }),
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

// Rate a card and update via repositories
export async function rateCard(
  card: StudyItem,
  rating: Grade
): Promise<void> {
  const existingState = card.isReverse ? card.reverseState : card.state;
  const { card: newState, log } = computeNewState(existingState, rating);

  // Store ReviewLog via repository
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
  const logRepo = getReviewLogRepository();
  await logRepo.insert(storedLog);

  // Update card state via repository
  const serializedState = serializeFsrsCard(newState);
  const cardRepo = getCardRepository();
  const field = card.isReverse ? 'reverseState' : 'state';
  await cardRepo.updateState(card.id, field, serializedState);

  notifyChange(card.id);
}

export function useDeck(deckName: string) {
  const { settings, isLoading: settingsLoading } = useSettings();
  const newCardsLimit = settings.newCardsPerDay;

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Query via repository hooks
  const { data: cardsList, isLoading: cardsLoading } = useCards(deckName);
  const { data: logsList, isLoading: logsLoading } = useReviewLogs();

  const isLoading = cardsLoading || logsLoading || settingsLoading;

  // Derive introduced-today from review logs (state=0 means "was New when reviewed")
  const today = new Date().toISOString().split('T')[0];
  const introducedToday = new Set(
    logsList
      .filter((l) => l.state === 0 && l.review.startsWith(today))
      .map((l) => l.isReverse ? `${l.cardSource}:reverse` : l.cardSource)
  );

  const { newItems, dueItems } = computeStudyItems(
    cardsList,
    newCardsLimit,
    endOfDay,
    introducedToday
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
    rateCard(studyItem, rating);
  }

  async function suspend() {
    if (!studyItem) return;
    const cardRepo = getCardRepository();
    await cardRepo.suspend(studyItem.id);
    notifyChange(studyItem.id);
  }

  async function undo() {
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
    const serialized = previousState.due
      ? serializeFsrsCard(previousState)
      : null;

    // Update card state via repository
    const cardRepo = getCardRepository();
    const field = studyItem.isReverse ? 'reverseState' : 'state';
    await cardRepo.updateState(studyItem.id, field, serialized);

    // Remove the log entry via repository
    const logRepo = getReviewLogRepository();
    await logRepo.remove(lastLog.id);

    notifyChange(studyItem.id);
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
