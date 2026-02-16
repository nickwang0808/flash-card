import { useState, useEffect } from 'react';
import { type Card } from 'ts-fsrs';
import type { CardData } from './git-storage';
import type { AppDatabase } from './rxdb';

// FlashCard: content + FSRS state in one structure (UI contract, deserialized dates)
export interface FlashCard {
  id: string;                  // composite key: "deckName|term"
  deckName: string;
  term: string;                // raw key (TTS-readable)
  front?: string;              // markdown display for front (defaults to term)
  back: string;                // markdown display for back
  tags?: string[];
  created: string;
  reversible: boolean;
  order: number;               // position in cards.json (for stable sort)
  state: Card | null;
  reverseState: Card | null;
  suspended?: boolean;
}

export interface CardRepository {
  getById(id: string): Promise<FlashCard | null>;
  getAll(): Promise<FlashCard[]>;
  getDeckNames(): Promise<string[]>;

  updateState(id: string, field: 'state' | 'reverseState', value: Record<string, unknown> | null): Promise<void>;
  suspend(id: string): Promise<void>;
  replaceAll(cards: CardData[]): Promise<void>;

  getCardDataByIds(ids: string[]): Promise<CardData[]>;
}

// --- Composite key helpers ---

function makeCardId(deckName: string, term: string): string {
  return `${deckName}|${term}`;
}

// --- Date serialization for FSRS Card objects ---

interface CardStateJSON extends Omit<Card, 'due' | 'last_review'> {
  due: string;
  last_review?: string;
}

function parseCardState(json: CardStateJSON): Card {
  return {
    ...json,
    due: new Date(json.due),
    last_review: json.last_review ? new Date(json.last_review) : undefined,
  } as Card;
}

// Serialize FSRS Card for RxDB storage (Dates -> ISO strings)
export function serializeFsrsCard(card: Card): Record<string, unknown> {
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

function deserializeCardDates(card: FlashCard): FlashCard {
  return {
    ...card,
    state: card.state ? parseCardState(card.state as any) : null,
    reverseState: card.reverseState ? parseCardState(card.reverseState as any) : null,
  };
}

// --- RxDB implementation ---

// Internal type matching RxDB card document shape
type CardDoc = {
  id: string;
  deckName: string;
  term: string;
  front?: string;
  back: string;
  tags?: string[];
  created: string;
  reversible: boolean;
  order: number;
  state: Record<string, unknown> | null;
  reverseState: Record<string, unknown> | null;
  suspended?: boolean;
};

function docToFlashCard(doc: CardDoc): FlashCard {
  return deserializeCardDates({
    id: doc.id,
    deckName: doc.deckName,
    term: doc.term,
    front: doc.front || undefined,
    back: doc.back,
    tags: doc.tags,
    created: doc.created,
    reversible: doc.reversible,
    order: doc.order,
    state: doc.state as any,
    reverseState: doc.reverseState as any,
    suspended: doc.suspended,
  });
}

function docToCardData(doc: CardDoc): CardData {
  return {
    deckName: doc.deckName,
    term: doc.term,
    front: doc.front,
    back: doc.back,
    tags: doc.tags,
    created: doc.created,
    reversible: doc.reversible,
    order: doc.order,
    state: doc.state,
    reverseState: doc.reverseState,
    suspended: doc.suspended,
  };
}

export class RxDbCardRepository implements CardRepository {
  constructor(private db: AppDatabase) {}

  async getById(id: string): Promise<FlashCard | null> {
    const doc = await this.db.cards.findOne(id).exec();
    if (!doc) return null;
    return docToFlashCard(doc.toJSON() as CardDoc);
  }

  async getAll(): Promise<FlashCard[]> {
    const docs = await this.db.cards.find().exec();
    return docs.map((d) => docToFlashCard(d.toJSON() as CardDoc));
  }

  async getDeckNames(): Promise<string[]> {
    const docs = await this.db.cards.find().exec();
    return [...new Set(docs.map((d) => d.deckName))];
  }

  async updateState(id: string, field: 'state' | 'reverseState', value: Record<string, unknown> | null): Promise<void> {
    const doc = await this.db.cards.findOne(id).exec();
    if (doc) {
      await doc.incrementalPatch({ [field]: value });
    }
  }

  async suspend(id: string): Promise<void> {
    const doc = await this.db.cards.findOne(id).exec();
    if (doc) {
      await doc.incrementalPatch({ suspended: true });
    }
  }

  async replaceAll(cards: CardData[]): Promise<void> {
    await this.db.cards.find().remove();
    if (cards.length > 0) {
      await this.db.cards.bulkInsert(
        cards.map((c) => ({
          id: makeCardId(c.deckName, c.term),
          deckName: c.deckName,
          term: c.term,
          front: c.front || undefined,
          back: c.back,
          tags: c.tags ?? [],
          created: c.created,
          reversible: c.reversible,
          order: c.order,
          state: c.state,
          reverseState: c.reverseState,
          suspended: c.suspended ?? false,
        })),
      );
    }
  }

  async getCardDataByIds(ids: string[]): Promise<CardData[]> {
    const result: CardData[] = [];
    for (const id of ids) {
      const doc = await this.db.cards.findOne(id).exec();
      if (doc) {
        result.push(docToCardData(doc.toJSON() as CardDoc));
      }
    }
    return result;
  }

  subscribeCards(deckName: string, cb: (cards: FlashCard[]) => void): () => void {
    const sub = this.db.cards
      .find({ selector: { deckName }, sort: [{ order: 'asc' }] })
      .$.subscribe((docs) => {
        cb(docs.map((d) => docToFlashCard(d.toJSON() as CardDoc)));
      });
    return () => sub.unsubscribe();
  }

  subscribeDeckNames(cb: (names: string[]) => void): () => void {
    let prev: string[] = [];
    const sub = this.db.cards.find().$.subscribe((docs) => {
      const names = [...new Set(docs.map((d) => d.deckName))].sort();
      if (names.length !== prev.length || names.some((n, i) => n !== prev[i])) {
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
