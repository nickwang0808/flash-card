import { useState, useEffect } from 'react';
import { combineLatest } from 'rxjs';
import { type Card } from 'ts-fsrs';
import type { AppDatabase, CardDoc, SrsStateDoc } from './rxdb';

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

export interface CardRepository {
  getById(id: string): Promise<FlashCard | null>;
  updateState(id: string, field: 'state' | 'reverseState', value: Record<string, unknown> | null): Promise<void>;
  suspend(id: string): Promise<void>;
}

export function serializeFsrsCard(card: Card): Record<string, unknown> {
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

// --- Join card doc + srs_state docs → FlashCard ---

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

// --- RxDB implementation ---

export class RxDbCardRepository implements CardRepository {
  constructor(private db: AppDatabase) {}

  async getById(id: string): Promise<FlashCard | null> {
    const doc = await this.db.cards.findOne(id).exec();
    if (!doc) return null;
    const card = doc.toJSON() as CardDoc;
    const fwd = await this.db.srsState.findOne(`${id}:forward`).exec();
    const rev = await this.db.srsState.findOne(`${id}:reverse`).exec();
    return joinToFlashCard(
      card,
      fwd?.toJSON() as SrsStateDoc | undefined,
      rev?.toJSON() as SrsStateDoc | undefined,
    );
  }

  async updateState(id: string, field: 'state' | 'reverseState', value: Record<string, unknown> | null): Promise<void> {
    const direction = field === 'state' ? 'forward' : 'reverse';
    const srsId = `${id}:${direction}`;

    if (value === null) {
      const doc = await this.db.srsState.findOne(srsId).exec();
      if (doc) await doc.remove();
    } else {
      const card = await this.db.cards.findOne(id).exec();
      if (!card) return;

      await this.db.srsState.upsert({
        id: srsId,
        userId: card.userId,
        cardId: id,
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

  async suspend(id: string): Promise<void> {
    const doc = await this.db.cards.findOne(id).exec();
    if (doc) {
      await doc.incrementalPatch({ suspended: true });
    }
  }

  subscribeCards(deckName: string, cb: (cards: FlashCard[]) => void): () => void {
    const cards$ = this.db.cards
      .find({ selector: { deckName }, sort: [{ order: 'asc' }] }).$;
    const srs$ = this.db.srsState.find().$;

    const sub = combineLatest([cards$, srs$]).subscribe(([cardDocs, srsDocs]) => {
      const srsMap = new Map<string, SrsStateDoc>();
      for (const d of srsDocs) srsMap.set(d.id, d.toJSON() as SrsStateDoc);

      cb(cardDocs.map((d) => {
        const card = d.toJSON() as CardDoc;
        return joinToFlashCard(card, srsMap.get(`${card.id}:forward`), srsMap.get(`${card.id}:reverse`));
      }));
    });
    return () => sub.unsubscribe();
  }

  subscribeDeckNames(cb: (names: string[]) => void): () => void {
    let first = true;
    let prev: string[] = [];
    const sub = this.db.cards.find().$.subscribe((docs) => {
      const names = [...new Set(docs.map((d) => d.deckName))].sort();
      if (first || names.length !== prev.length || names.some((n, i) => n !== prev[i])) {
        first = false;
        prev = names;
        cb(names);
      }
    });
    return () => sub.unsubscribe();
  }
}

// --- DI ---

let instance: CardRepository | null = null;

export function getCardRepository(): CardRepository {
  if (!instance) throw new Error('CardRepository not initialized. Call setCardRepository() first.');
  return instance;
}

export function setCardRepository(repo: CardRepository | null): void {
  instance = repo;
}

// --- React hooks ---

export function useCards(deckName: string): { data: FlashCard[]; isLoading: boolean } {
  const [data, setData] = useState<FlashCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const repo = getCardRepository() as RxDbCardRepository;
    const unsub = repo.subscribeCards(deckName, (cards) => {
      setData(cards);
      setIsLoading(false);
    });
    return unsub;
  }, [deckName]);

  return { data, isLoading };
}

export function useDeckNames(): { data: string[]; isLoading: boolean } {
  const [data, setData] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const repo = getCardRepository() as RxDbCardRepository;
    const unsub = repo.subscribeDeckNames((names) => {
      setData(names);
      setIsLoading(false);
    });
    return unsub;
  }, []);

  return { data, isLoading };
}
