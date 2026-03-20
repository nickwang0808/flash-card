import { fsrs, createEmptyCard, Rating, State, type Grade, type Card, type ReviewLog } from 'ts-fsrs';
import { type FlashCard, useCards, getCardRepository, serializeFsrsCard } from '../services/card-repository';
import { useRxQuery } from './useRxQuery';
import { getDatabaseSync, type ReviewLogDoc } from '../services/rxdb';

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
function isDue(card: Card, now: Date, endOfDay: Date): boolean {
  if (card.state === State.Learning || card.state === State.Relearning) {
    return card.due <= endOfDay;
  }
  return card.due <= now;
}

export function computeStudyItems(
  cards: FlashCard[],
  newCardsLimit: number,
  now: Date,
  introducedToday: Set<string> = new Set()
): { newItems: StudyItem[]; dueItems: StudyItem[] } {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const newForward: StudyItem[] = [];
  const newReverse: StudyItem[] = [];
  const dueForward: StudyItem[] = [];
  const dueReverse: StudyItem[] = [];

  const activeCards = cards.filter(card => !card.suspended);

  const introducedCount = introducedToday.size;
  const remainingNewSlots = Math.max(0, newCardsLimit - introducedCount);
  let newSlotsUsed = 0;

  for (const card of activeCards) {
    if (!card.state) {
      const forwardIntroduced = introducedToday.has(card.term);

      if (card.reversible && !card.reverseState) {
        const reverseKey = `${card.term}:reverse`;
        const reverseIntroduced = introducedToday.has(reverseKey);
        const slotsNeeded = (forwardIntroduced ? 0 : 1) + (reverseIntroduced ? 0 : 1);

        if (slotsNeeded <= remainingNewSlots - newSlotsUsed) {
          newForward.push({ ...card, isReverse: false });
          newReverse.push({ ...card, isReverse: true });
          newSlotsUsed += slotsNeeded;
        } else {
          if (forwardIntroduced) {
            newForward.push({ ...card, isReverse: false });
          }
          if (reverseIntroduced) {
            newReverse.push({ ...card, isReverse: true });
          }
          if (!forwardIntroduced && newSlotsUsed < remainingNewSlots) {
            newForward.push({ ...card, isReverse: false });
            newSlotsUsed++;
          }
        }
      } else {
        if (forwardIntroduced || newSlotsUsed < remainingNewSlots) {
          newForward.push({ ...card, isReverse: false });
          if (!forwardIntroduced) newSlotsUsed++;
        }
      }
    } else if (isDue(card.state, now, endOfDay)) {
      dueForward.push({ ...card, isReverse: false });
    }

    if (card.reversible) {
      const handledAtomically = !card.state && !card.reverseState;
      if (!handledAtomically) {
        if (!card.reverseState) {
          const reverseKey = `${card.term}:reverse`;
          const isIntroduced = introducedToday.has(reverseKey);
          if (isIntroduced || newSlotsUsed < remainingNewSlots) {
            newReverse.push({ ...card, isReverse: true });
            if (!isIntroduced) newSlotsUsed++;
          }
        } else if (isDue(card.reverseState, now, endOfDay)) {
          dueReverse.push({ ...card, isReverse: true });
        }
      }
    }
  }

  return {
    newItems: [...newForward, ...newReverse],
    dueItems: [...dueForward, ...dueReverse].sort((a, b) => {
      const aDue = a.isReverse ? a.reverseState!.due : a.state!.due;
      const bDue = b.isReverse ? b.reverseState!.due : b.state!.due;
      return aDue.getTime() - bDue.getTime();
    }),
  };
}

export function computeNewState(
  existingState: Card | null,
  rating: Grade,
  now: Date = new Date()
): { card: Card; log: ReviewLog } {
  const currentState: Card = existingState ?? createEmptyCard();
  const result = fsrs().repeat(currentState, now)[rating];
  return { card: result.card, log: result.log };
}

export async function rateCard(
  card: StudyItem,
  rating: Grade
): Promise<void> {
  const existingState = card.isReverse ? card.reverseState : card.state;
  const { card: newState, log } = computeNewState(existingState, rating);

  // Get user_id from the card (set by replication)
  const db = getDatabaseSync();
  const cardDoc = await db.cards.findOne(card.id).exec();
  const userId = cardDoc?.user_id ?? '';

  const storedLog: ReviewLogDoc = {
    id: `${card.id}:${card.isReverse ? 'reverse' : 'forward'}:${Date.now()}`,
    user_id: userId,
    card_id: card.id,
    is_reverse: card.isReverse,
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
  await db.review_logs.insert(storedLog);

  const serializedState = serializeFsrsCard(newState);
  const cardRepo = getCardRepository();
  const field = card.isReverse ? 'reverseState' : 'state';
  await cardRepo.updateState(card.id, field, serializedState);
}

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

  const db = getDatabaseSync();
  const cardDoc = await db.cards.findOne(card.id).exec();
  const userId = cardDoc?.user_id ?? '';

  const storedLog: ReviewLogDoc = {
    id: `${card.id}:${card.isReverse ? 'reverse' : 'forward'}:${Date.now()}`,
    user_id: userId,
    card_id: card.id,
    is_reverse: card.isReverse,
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

  await db.review_logs.insert(storedLog);

  const serializedState = serializeFsrsCard(newState);
  const cardRepo = getCardRepository();
  const field = card.isReverse ? 'reverseState' : 'state';
  await cardRepo.updateState(card.id, field, serializedState);
}

export function useDeck(deckName: string) {
  const db = getDatabaseSync();
  const { data: settingsList, isLoading: settingsLoading } = useRxQuery(db.settings);
  const { data: cardsList, isLoading: cardsLoading } = useCards(deckName);
  const { data: logsList, isLoading: logsLoading } = useRxQuery(db.review_logs);

  const newCardsLimit = settingsList[0]?.new_cards_per_day ?? 10;
  const isLoading = cardsLoading || logsLoading || settingsLoading;

  const todayLocal = new Date().toLocaleDateString('en-CA');
  const introducedToday = new Set(
    logsList
      .filter((l) => l.state === 0 && new Date(l.review).toLocaleDateString('en-CA') === todayLocal)
      .map((l) => {
        const term = l.card_id.split('|')[1] ?? l.card_id;
        return l.is_reverse ? `${term}:reverse` : term;
      })
  );

  const { newItems, dueItems } = computeStudyItems(
    cardsList,
    newCardsLimit,
    new Date(),
    introducedToday
  );

  const allItems = [...newItems, ...dueItems];
  const studyItem = allItems[0] ?? null;

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
  }

  async function undo() {
    const sorted = [...logsList].sort(
      (a, b) => parseInt(b.id.split(':')[2]) - parseInt(a.id.split(':')[2])
    );
    const lastLog = sorted[0];
    if (!lastLog) return;

    const cardRepo = getCardRepository();
    const field = lastLog.is_reverse ? 'reverseState' : 'state';

    if (lastLog.state === 0) {
      await cardRepo.updateState(lastLog.card_id, field, null);
    } else {
      const card = await cardRepo.getById(lastLog.card_id);
      if (!card) return;

      const currentState = lastLog.is_reverse ? card.reverseState : card.state;
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
      await cardRepo.updateState(lastLog.card_id, field, serializeFsrsCard(previousState));
    }

    const logDoc = await getDatabaseSync().review_logs.findOne(lastLog.id).exec();
    if (logDoc) await logDoc.remove();
  }

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
    newItems,
    dueItems,
  };
}
