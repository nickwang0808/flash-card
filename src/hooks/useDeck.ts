import { useState, useEffect } from 'react';
import { combineLatest } from 'rxjs';
import { fsrs, createEmptyCard, Rating, State, type Grade, type Card, type ReviewLog } from 'ts-fsrs';
import { useRxQuery } from './useRxQuery';
import { useErrorBanner } from './useErrorBanner';
import { getDatabaseSync, type CardDoc, type SrsStateDoc } from '../services/rxdb';
import { supabase } from '../services/supabase';

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

// --- Auth helper ---

async function getAuthUserId(cardId?: string): Promise<string> {
  if (cardId) {
    const doc = await getDatabaseSync().cards.findOne(cardId).exec();
    if (doc?.userId) return doc.userId;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// --- SRS state helpers (query by cardId + direction, not by ID) ---

async function findSrsState(cardId: string, direction: string): Promise<any | null> {
  const db = getDatabaseSync();
  const docs = await db.srsState.find({
    selector: { cardId, direction },
  }).exec();
  return docs[0] ?? null;
}

async function updateSrsState(
  cardId: string,
  field: 'state' | 'reverseState',
  value: Record<string, unknown> | null,
): Promise<void> {
  const db = getDatabaseSync();
  const direction = field === 'state' ? 'forward' : 'reverse';

  if (value === null) {
    const doc = await findSrsState(cardId, direction);
    if (doc) await doc.incrementalRemove();
  } else {
    const userId = await getAuthUserId(cardId);
    const existing = await findSrsState(cardId, direction);

    if (existing) {
      await existing.incrementalPatch({
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
    } else {
      await db.srsState.insert({
        id: crypto.randomUUID(),
        userId,
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
}

async function getFlashCardById(cardId: string): Promise<FlashCard | null> {
  const db = getDatabaseSync();
  const doc = await db.cards.findOne(cardId).exec();
  if (!doc) return null;
  const card = doc.toJSON() as CardDoc;
  const fwd = await findSrsState(cardId, 'forward');
  const rev = await findSrsState(cardId, 'reverse');
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

  const activeCards = cards.filter(card => !card.suspended);

  // Step 1: Collect candidates in priority order and due items
  const orphanedReverses: StudyItem[] = [];  // priority: have forward SRS but no reverse
  const newCandidates: StudyItem[] = [];     // new cards in card order (fwd, rev interleaved)
  const dueItems: StudyItem[] = [];

  for (const card of activeCards) {
    if (!card.state) {
      // New card — add forward
      newCandidates.push({ ...card, isReverse: false });
      // Add reverse too if reversible
      if (card.reversible && !card.reverseState) {
        newCandidates.push({ ...card, isReverse: true });
      }
    } else if (isDue(card.state, now, endOfDay)) {
      dueItems.push({ ...card, isReverse: false });
    }

    // Handle reverse direction separately
    if (card.reversible) {
      if (card.state && !card.reverseState) {
        // Orphaned reverse: forward has SRS but reverse doesn't
        orphanedReverses.push({ ...card, isReverse: true });
      } else if (card.reverseState && isDue(card.reverseState, now, endOfDay)) {
        // Reverse is due (regardless of forward state)
        dueItems.push({ ...card, isReverse: true });
      }
    }
  }

  // Step 2: Separate already-introduced items (always include) from fresh candidates
  const introducedItems: StudyItem[] = [];
  const freshOrphans: StudyItem[] = [];
  const freshNew: StudyItem[] = [];

  for (const item of orphanedReverses) {
    const key = `${item.term}:reverse`;
    if (introducedToday.has(key)) {
      introducedItems.push(item);
    } else {
      freshOrphans.push(item);
    }
  }

  for (const item of newCandidates) {
    const key = item.isReverse ? `${item.term}:reverse` : item.term;
    if (introducedToday.has(key)) {
      introducedItems.push(item);
    } else {
      freshNew.push(item);
    }
  }

  // Step 3: Fill remaining slots — orphaned reverses first, then new cards
  const remainingSlots = Math.max(0, newCardsLimit - introducedToday.size);
  const selected = [...introducedItems];
  let slotsUsed = 0;

  for (const item of freshOrphans) {
    if (slotsUsed >= remainingSlots) break;
    selected.push(item);
    slotsUsed++;
  }

  for (const item of freshNew) {
    if (slotsUsed >= remainingSlots) break;
    selected.push(item);
    slotsUsed++;
  }

  // Step 4: Sort — all forwards first, then all reverses (preserve card order within)
  selected.sort((a, b) => {
    if (a.isReverse !== b.isReverse) return a.isReverse ? 1 : -1;
    return 0; // stable sort preserves card order within each group
  });

  // Sort due items by due date
  dueItems.sort((a, b) => {
    const aDue = a.isReverse ? a.reverseState!.due : a.state!.due;
    const bDue = b.isReverse ? b.reverseState!.due : b.state!.due;
    return aDue.getTime() - bDue.getTime();
  });

  return { newItems: selected, dueItems };
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
  const userId = await getAuthUserId(card.id);

  await db.reviewLogs.insert({
    id: crypto.randomUUID(),
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
  const userId = await getAuthUserId(card.id);

  await db.reviewLogs.insert({
    id: crypto.randomUUID(),
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
      // Index srsState by cardId+direction
      const srsMap = new Map<string, SrsStateDoc>();
      for (const d of srsDocs) {
        const s = d.toJSON() as SrsStateDoc;
        srsMap.set(`${s.cardId}:${s.direction}`, s);
      }

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
  const { showError } = useErrorBanner();

  // Only load today's review logs (for introduced-today tracking + undo)
  const todayLocal = new Date().toLocaleDateString('en-CA');
  const todayStart = `${todayLocal}T00:00:00`;
  const { data: logsList, isLoading: logsLoading } = useRxQuery(db.reviewLogs, {
    selector: { review: { $gte: todayStart } },
  });

  const newCardsLimit = settingsList[0]?.newCardsPerDay ?? 10;
  const isLoading = cardsLoading || logsLoading || settingsLoading;

  function handleError(err: unknown) {
    const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
    showError(msg);
  }

  // Build a map of cardId → term for the introduced-today check
  const cardTermMap = new Map(cardsList.map(c => [c.id, c.term]));

  const introducedToday = new Set(
    logsList
      .filter((l) => l.state === 0)
      .map((l) => {
        const term = cardTermMap.get(l.cardId) ?? l.cardId;
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

  async function rate(rating: Grade) {
    if (!studyItem) return;
    try {
      await rateCard(studyItem, rating);
    } catch (err) {
      handleError(err);
    }
  }

  async function superEasy() {
    if (!studyItem) return;
    try {
      await rateCardSuperEasy(studyItem);
    } catch (err) {
      handleError(err);
    }
  }

  async function suspend() {
    if (!studyItem) return;
    try {
      const doc = await db.cards.findOne(studyItem.id).exec();
      if (doc) await doc.incrementalPatch({ suspended: true });
    } catch (err) {
      handleError(err);
    }
  }

  async function undo() {
    try {
      // Find the most recent review log by review timestamp
      const sorted = [...logsList].sort(
        (a, b) => new Date(b.review).getTime() - new Date(a.review).getTime()
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
      if (logDoc) await logDoc.incrementalRemove();
    } catch (err) {
      handleError(err);
    }
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
