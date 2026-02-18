import { fsrs, createEmptyCard, Rating, State, type Grade, type Card, type ReviewLog } from 'ts-fsrs';
import { type FlashCard, useCards, getCardRepository, serializeFsrsCard } from '../services/card-repository';
import { type StoredReviewLog, useReviewLogs, getReviewLogRepository } from '../services/review-log-repository';
import { useSettings } from './useSettings';
import { notifyChange } from '../services/replication';

export type StudyItem = FlashCard & { isReverse: boolean };

interface CurrentCard {
  term: string;              // raw key (TTS-readable)
  front: string;             // resolved display front (markdown)
  back: string;              // resolved display back (markdown)
  isReverse: boolean;
  isNew: boolean;
}

export function formatInterval(due: Date, now: Date = new Date()): string {
  const diffMs = due.getTime() - now.getTime();
  const diffMin = diffMs / (1000 * 60);
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const diffMonths = diffDays / 30;

  if (diffMin < 60) return `${Math.round(diffMin)}m`;
  if (diffHours < 24) return `${Math.round(diffHours)}h`;
  if (diffDays < 30) return `${Math.round(diffDays)}d`;
  return `${Math.round(diffMonths)}mo`;
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

  // Single pass: process forward and reverse directions together
  // Reversible cards where both directions are new reserve slots atomically
  for (const card of activeCards) {
    // === Forward direction ===
    if (!card.state) {
      const forwardIntroduced = introducedToday.has(card.term);

      if (card.reversible && !card.reverseState) {
        // Both directions are new — reserve slots atomically
        const reverseKey = `${card.term}:reverse`;
        const reverseIntroduced = introducedToday.has(reverseKey);
        const slotsNeeded = (forwardIntroduced ? 0 : 1) + (reverseIntroduced ? 0 : 1);

        if (slotsNeeded <= remainingNewSlots - newSlotsUsed) {
          // Enough slots for both directions
          newForward.push({ ...card, isReverse: false });
          newReverse.push({ ...card, isReverse: true });
          newSlotsUsed += slotsNeeded;
        } else {
          // Not enough slots for both — add introduced directions (free)
          if (forwardIntroduced) {
            newForward.push({ ...card, isReverse: false });
          }
          if (reverseIntroduced) {
            newReverse.push({ ...card, isReverse: true });
          }
          // Try to fit forward with a remaining slot
          if (!forwardIntroduced && newSlotsUsed < remainingNewSlots) {
            newForward.push({ ...card, isReverse: false });
            newSlotsUsed++;
          }
        }
      } else {
        // Not both-new-reversible — standard forward handling
        if (forwardIntroduced || newSlotsUsed < remainingNewSlots) {
          newForward.push({ ...card, isReverse: false });
          if (!forwardIntroduced) newSlotsUsed++;
        }
      }
    } else if (card.state.due <= endOfDay) {
      dueForward.push({ ...card, isReverse: false });
    }

    // === Reverse direction (independent — not both-new case) ===
    if (card.reversible) {
      const handledAtomically = !card.state && !card.reverseState;
      if (!handledAtomically) {
        if (!card.reverseState) {
          // Reverse is new, forward is not new
          const reverseKey = `${card.term}:reverse`;
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
    id: `${card.id}:${card.isReverse ? 'reverse' : 'forward'}:${Date.now()}`,
    cardId: card.id,
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

// Rate a card as "Super Easy" — bypasses FSRS, schedules N days out
// Only for new cards the user already knows well (e.g. from Anki)
export async function rateCardSuperEasy(
  card: StudyItem,
  days = 60,
  now = new Date()
): Promise<void> {
  const due = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const newState: Card = {
    due,
    stability: days,
    difficulty: 4,
    elapsed_days: 0,
    scheduled_days: days,
    reps: 1,
    lapses: 0,
    state: State.Review,
    last_review: now,
  };

  // state: State.New (0) in the log is critical — undo checks state===0 to restore to null
  const storedLog: StoredReviewLog = {
    id: `${card.id}:${card.isReverse ? 'reverse' : 'forward'}:${Date.now()}`,
    cardId: card.id,
    isReverse: card.isReverse,
    rating: Rating.Easy,
    state: State.New,
    due: due.toISOString(),
    stability: days,
    difficulty: 4,
    elapsed_days: 0,
    last_elapsed_days: 0,
    scheduled_days: days,
    review: now.toISOString(),
  };

  const logRepo = getReviewLogRepository();
  await logRepo.insert(storedLog);

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
  const todayLocal = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const introducedToday = new Set(
    logsList
      .filter((l) => l.state === 0 && new Date(l.review).toLocaleDateString('en-CA') === todayLocal)
      .map((l) => {
        // Extract term from cardId (format: "deckName|term")
        const term = l.cardId.split('|')[1] ?? l.cardId;
        return l.isReverse ? `${term}:reverse` : term;
      })
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
  // front defaults to term if not set; reverse swaps front↔back
  const currentCard: CurrentCard | null = studyItem
    ? {
        term: studyItem.term,
        front: studyItem.isReverse
          ? studyItem.back
          : (studyItem.front || studyItem.term),
        back: studyItem.isReverse
          ? (studyItem.front || studyItem.term)
          : studyItem.back,
        isReverse: studyItem.isReverse,
        isNew: studyItem.isReverse ? !studyItem.reverseState : !studyItem.state,
      }
    : null;

  // Compute schedule preview for each rating (shown on UI buttons)
  const previewNow = new Date();
  const existingFsrsState = studyItem
    ? (studyItem.isReverse ? studyItem.reverseState : studyItem.state)
    : null;
  const schedulePreview = studyItem ? {
    [Rating.Again]: formatInterval(computeNewState(existingFsrsState, Rating.Again, previewNow).card.due, previewNow),
    [Rating.Hard]:  formatInterval(computeNewState(existingFsrsState, Rating.Hard,  previewNow).card.due, previewNow),
    [Rating.Good]:  formatInterval(computeNewState(existingFsrsState, Rating.Good,  previewNow).card.due, previewNow),
    [Rating.Easy]:  formatInterval(computeNewState(existingFsrsState, Rating.Easy,  previewNow).card.due, previewNow),
  } : null;

  function rate(rating: Grade) {
    if (!studyItem) return;
    rateCard(studyItem, rating);
  }

  function superEasy() {
    if (!studyItem) return;
    rateCardSuperEasy(studyItem);
  }

  async function suspend() {
    if (!studyItem) return;
    const cardRepo = getCardRepository();
    await cardRepo.suspend(studyItem.id);
    notifyChange(studyItem.id);
  }

  async function undo() {
    // Find the most recent review log overall
    const sorted = [...logsList].sort(
      (a: StoredReviewLog, b: StoredReviewLog) =>
        parseInt(b.id.split(':')[2]) - parseInt(a.id.split(':')[2])
    );
    const lastLog = sorted[0];
    if (!lastLog) return;

    const cardRepo = getCardRepository();
    const field = lastLog.isReverse ? 'reverseState' : 'state';

    if (lastLog.state === 0) {
      // Card was New when reviewed — restore to null
      await cardRepo.updateState(lastLog.cardId, field, null);
    } else {
      // Look up the card to get its current FSRS state for rollback
      const card = await cardRepo.getById(lastLog.cardId);
      if (!card) return;

      const currentState = lastLog.isReverse ? card.reverseState : card.state;
      if (!currentState) return;

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

      const previousState = fsrs().rollback(currentState, reviewLog);
      await cardRepo.updateState(lastLog.cardId, field, serializeFsrsCard(previousState));
    }

    // Remove the log entry
    const logRepo = getReviewLogRepository();
    await logRepo.remove(lastLog.id);

    notifyChange(lastLog.cardId);
  }

  // Check if undo is available (any review log exists)
  const canUndo = logsList.length > 0;

  return {
    isLoading,
    currentCard,
    remaining: allItems.length,
    rate,
    superEasy,
    schedulePreview,
    suspend,
    undo,
    canUndo,
    // Expose for testing/advanced use
    newItems,
    dueItems,
  };
}
