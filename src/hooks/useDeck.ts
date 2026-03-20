import { useState, useEffect } from 'react';
import { combineLatest } from 'rxjs';
import { fsrs, createEmptyCard, Rating, State, type Grade, type Card, type ReviewLog } from 'ts-fsrs';
import { useRxQuery } from './useRxQuery';
import { getDatabaseSync, type CardDoc, type SrsStateDoc } from '../services/rxdb';

// --- FlashCard: UI contract with deserialized FSRS dates ---

export interface FlashCard {
  id: string;
  deckName: string;
  term: string;
  front?: string;
  back: string;
  tags?: string[];
  created: string;
  reversible: boolean;
  order: number;
  state: Card | null;
  reverseState: Card | null;
  suspended?: boolean;
}

export type StudyItem = FlashCard & { isReverse: boolean };

interface CurrentCard {
  term: string;
  front: string;
  back: string;
  isReverse: boolean;
  isNew: boolean;
}

// --- FSRS serialization (camelCase RxDB ↔ ts-fsrs snake_case) ---

function srsDocToCard(doc: SrsStateDoc): Card | null {
  if (!doc.due) return null;
  return {
    due: new Date(doc.due),
    stability: doc.stability ?? 0,
    difficulty: doc.difficulty ?? 0,
    elapsed_days: doc.elapsedDays ?? 0,
    scheduled_days: doc.scheduledDays ?? 0,
    reps: doc.reps ?? 0,
    lapses: doc.lapses ?? 0,
    state: doc.state ?? 0,
    last_review: doc.lastReview ? new Date(doc.lastReview) : undefined,
  } as Card;
}

function serializeFsrsCard(card: Card): Record<string, unknown> {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString(),
  };
}

function joinToFlashCard(
  card: CardDoc,
  forwardSrs?: SrsStateDoc,
  reverseSrs?: SrsStateDoc,
): FlashCard {
  return {
    id: card.id,
    deckName: card.deckName,
    term: card.term,
    front: card.front || undefined,
    back: card.back,
    tags: card.tags ? JSON.parse(card.tags) : undefined,
    created: card.created,
    reversible: card.reversible ?? false,
    order: card.order ?? 0,
    state: forwardSrs ? srsDocToCard(forwardSrs) : null,
    reverseState: reverseSrs ? srsDocToCard(reverseSrs) : null,
    suspended: card.suspended,
  };
}

// --- DB write helpers ---

async function updateSrsState(
  cardId: string,
  field: 'state' | 'reverseState',
  value: Record<string, unknown> | null,
): Promise<void> {
  const db = getDatabaseSync();
  const direction = field === 'state' ? 'forward' : 'reverse';
  const srsId = `${cardId}:${direction}`;

  if (value === null) {
    const doc = await db.srsState.findOne(srsId).exec();
    if (doc) await doc.remove();
  } else {
    const card = await db.cards.findOne(cardId).exec();
    if (!card) return;

    await db.srsState.upsert({
      id: srsId,
      userId: card.userId,
      cardId,
      direction,
      due: value.due as string,
      stability: value.stability as number,
      difficulty: value.difficulty as number,
      elapsedDays: value.elapsedDays as number,
      scheduledDays: value.scheduledDays as number,
      reps: value.reps as number,
      lapses: value.lapses as number,
      state: value.state as number,
      lastReview: value.lastReview as string | undefined,
    });
  }
}

async function getFlashCardById(cardId: string): Promise<FlashCard | null> {
  const db = getDatabaseSync();
  const doc = await db.cards.findOne(cardId).exec();
  if (!doc) return null;
  const card = doc.toJSON() as CardDoc;
  const fwd = await db.srsState.findOne(`${cardId}:forward`).exec();
  const rev = await db.srsState.findOne(`${cardId}:reverse`).exec();
  return joinToFlashCard(
    card,
    fwd?.toJSON() as SrsStateDoc | undefined,
    rev?.toJSON() as SrsStateDoc | undefined,
  );
}

// --- Pure computation ---

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
          if (forwardIntroduced) newForward.push({ ...card, isReverse: false });
          if (reverseIntroduced) newReverse.push({ ...card, isReverse: true });
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

// --- Rate / Undo / Suspend ---

export async function rateCard(card: StudyItem, rating: Grade): Promise<void> {
  const existingState = card.isReverse ? card.reverseState : card.state;
  const { card: newState, log } = computeNewState(existingState, rating);

  const db = getDatabaseSync();
  const cardDoc = await db.cards.findOne(card.id).exec();
  const userId = cardDoc?.userId ?? '';

  await db.reviewLogs.insert({
    id: `${card.id}:${card.isReverse ? 'reverse' : 'forward'}:${Date.now()}`,
    userId,
    cardId: card.id,
    isReverse: card.isReverse,
    rating: log.rating,
    state: log.state,
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsedDays: log.elapsed_days,
    lastElapsedDays: log.last_elapsed_days,
    scheduledDays: log.scheduled_days,
    review: log.review.toISOString(),
  });

  await updateSrsState(card.id, card.isReverse ? 'reverseState' : 'state', serializeFsrsCard(newState));
}

export async function rateCardSuperEasy(card: StudyItem, days = 60, now = new Date()): Promise<void> {
  const due = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const newState: Card = {
    due, stability: days, difficulty: 4, elapsed_days: 0,
    scheduled_days: days, reps: 1, lapses: 0, state: State.Review, last_review: now,
  };

  const db = getDatabaseSync();
  const cardDoc = await db.cards.findOne(card.id).exec();
  const userId = cardDoc?.userId ?? '';

  await db.reviewLogs.insert({
    id: `${card.id}:${card.isReverse ? 'reverse' : 'forward'}:${Date.now()}`,
    userId,
    cardId: card.id,
    isReverse: card.isReverse,
    rating: Rating.Easy,
    state: State.New,
    due: due.toISOString(),
    stability: days,
    difficulty: 4,
    elapsedDays: 0,
    lastElapsedDays: 0,
    scheduledDays: days,
    review: now.toISOString(),
  });

  await updateSrsState(card.id, card.isReverse ? 'reverseState' : 'state', serializeFsrsCard(newState));
}

// --- React hooks ---

function useCards(deckName: string): { data: FlashCard[]; isLoading: boolean } {
  const [data, setData] = useState<FlashCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const db = getDatabaseSync();
    const cards$ = db.cards.find({ selector: { deckName }, sort: [{ order: 'asc' }] }).$;
    const srs$ = db.srsState.find().$;

    const sub = combineLatest([cards$, srs$]).subscribe(([cardDocs, srsDocs]) => {
      const srsMap = new Map<string, SrsStateDoc>();
      for (const d of srsDocs) srsMap.set(d.id, d.toJSON() as SrsStateDoc);

      setData(cardDocs.map((d) => {
        const card = d.toJSON() as CardDoc;
        return joinToFlashCard(card, srsMap.get(`${card.id}:forward`), srsMap.get(`${card.id}:reverse`));
      }));
      setIsLoading(false);
    });
    return () => sub.unsubscribe();
  }, [deckName]);

  return { data, isLoading };
}

export function useDeckNames(): { data: string[]; isLoading: boolean } {
  const [data, setData] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const db = getDatabaseSync();
    let first = true;
    let prev: string[] = [];
    const sub = db.cards.find().$.subscribe((docs) => {
      const names = [...new Set(docs.map((d) => d.deckName))].sort();
      if (first || names.length !== prev.length || names.some((n, i) => n !== prev[i])) {
        first = false;
        prev = names;
        setData(names);
        setIsLoading(false);
      }
    });
    return () => sub.unsubscribe();
  }, []);

  return { data, isLoading };
}

export function useDeck(deckName: string) {
  const db = getDatabaseSync();
  const { data: settingsList, isLoading: settingsLoading } = useRxQuery(db.settings);
  const { data: cardsList, isLoading: cardsLoading } = useCards(deckName);

  // Only load today's review logs (for introduced-today tracking + undo)
  const todayLocal = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const todayStart = `${todayLocal}T00:00:00`;
  const { data: logsList, isLoading: logsLoading } = useRxQuery(db.reviewLogs, {
    selector: { review: { $gte: todayStart } },
  });

  const newCardsLimit = settingsList[0]?.newCardsPerDay ?? 10;
  const isLoading = cardsLoading || logsLoading || settingsLoading;

  const introducedToday = new Set(
    logsList
      .filter((l) => l.state === 0)
      .map((l) => {
        const term = l.cardId.split('|')[1] ?? l.cardId;
        return l.isReverse ? `${term}:reverse` : term;
      })
  );

  const { newItems, dueItems } = computeStudyItems(cardsList, newCardsLimit, new Date(), introducedToday);
  const allItems = [...newItems, ...dueItems];
  const studyItem = allItems[0] ?? null;

  const currentCard: CurrentCard | null = studyItem
    ? {
        term: studyItem.term,
        front: studyItem.isReverse ? studyItem.back : (studyItem.front || studyItem.term),
        back: studyItem.isReverse ? (studyItem.front || studyItem.term) : studyItem.back,
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
    const doc = await db.cards.findOne(studyItem.id).exec();
    if (doc) await doc.incrementalPatch({ suspended: true });
  }

  async function undo() {
    const sorted = [...logsList].sort(
      (a, b) => parseInt(b.id.split(':')[2]) - parseInt(a.id.split(':')[2])
    );
    const lastLog = sorted[0];
    if (!lastLog) return;

    const field = lastLog.isReverse ? 'reverseState' : 'state';

    if (lastLog.state === 0) {
      await updateSrsState(lastLog.cardId, field, null);
    } else {
      const card = await getFlashCardById(lastLog.cardId);
      if (!card) return;

      const currentState = lastLog.isReverse ? card.reverseState : card.state;
      if (!currentState) return;

      const reviewLog: ReviewLog = {
        rating: lastLog.rating as Rating,
        state: lastLog.state as State,
        due: new Date(lastLog.due),
        stability: lastLog.stability,
        difficulty: lastLog.difficulty,
        elapsed_days: lastLog.elapsedDays,
        last_elapsed_days: lastLog.lastElapsedDays,
        scheduled_days: lastLog.scheduledDays,
        review: new Date(lastLog.review),
      };

      const previousState = fsrs().rollback(currentState, reviewLog);
      await updateSrsState(lastLog.cardId, field, serializeFsrsCard(previousState));
    }

    const logDoc = await db.reviewLogs.findOne(lastLog.id).exec();
    if (logDoc) await logDoc.remove();
  }

  return {
    isLoading,
    currentCard,
    remaining: allItems.length,
    rate,
    superEasy,
    schedulePreview,
    suspend,
    undo,
    canUndo: logsList.length > 0,
    newItems,
    dueItems,
  };
}
