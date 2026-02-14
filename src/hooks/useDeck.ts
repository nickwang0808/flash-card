import { fsrs, createEmptyCard, type Grade, type Card, type ReviewLog, type Rating, type State } from 'ts-fsrs';
import { type FlashCard, type StoredReviewLog } from '../services/collections';
import { useSettings } from './useSettings';
import { parseCardState, notifyChange } from '../services/replication';
import { useRxQuery } from './useRxQuery';
import { getDatabaseSync } from '../services/rxdb';

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

// Serialize FSRS Card for RxDB storage (Dates → ISO strings)
// RxDB incrementalPatch can hang if the document contains native Date objects
// in schema-free fields, so always store as plain JSON.
function serializeFsrsCard(card: Card): Record<string, unknown> {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.toISOString(),
  };
}

// Rate a card and update RxDB directly
export async function rateCard(
  card: StudyItem,
  rating: Grade
): Promise<void> {
  const existingState = card.isReverse ? card.reverseState : card.state;
  const { card: newState, log } = computeNewState(existingState, rating);

  // Store ReviewLog in RxDB for undo functionality
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
  const db = getDatabaseSync();
  await db.reviewlogs.insert(storedLog);

  // Update card in RxDB directly
  const serializedState = serializeFsrsCard(newState);
  const doc = await db.cards.findOne(card.id).exec();
  if (doc) {
    if (card.isReverse) {
      await doc.incrementalPatch({ reverseState: serializedState });
    } else {
      await doc.incrementalPatch({ state: serializedState });
    }
  }

  notifyChange();
}

export function useDeck(deckName: string) {
  const { settings, isLoading: settingsLoading } = useSettings();
  const newCardsLimit = settings.newCardsPerDay;

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Query RxDB directly
  const db = getDatabaseSync();
  const { data: allCards, isLoading: cardsLoading } = useRxQuery(
    db.cards,
    { selector: { deckName }, sort: [{ created: 'asc' }] }
  );
  const { data: logs, isLoading: logsLoading } = useRxQuery(db.reviewlogs);

  const isLoading = cardsLoading || logsLoading || settingsLoading;

  // Deserialize FSRS dates from strings to Date objects
  const cardsList = (allCards as unknown as FlashCard[]).map(deserializeCardDates);
  const logsList = (logs ?? []) as unknown as StoredReviewLog[];

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
    const doc = await db.cards.findOne(studyItem.id).exec();
    if (doc) {
      await doc.incrementalPatch({ suspended: true });
      notifyChange();
    }
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

    // Update card state in RxDB directly
    const cardDoc = await db.cards.findOne(studyItem.id).exec();
    if (cardDoc) {
      if (studyItem.isReverse) {
        await cardDoc.incrementalPatch({ reverseState: serialized });
      } else {
        await cardDoc.incrementalPatch({ state: serialized });
      }
    }

    // Remove the log entry from RxDB
    const logDoc = await db.reviewlogs.findOne(lastLog.id).exec();
    if (logDoc) await logDoc.remove();

    notifyChange();
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
