import {
  cardsCollection,
  cardStatesCollection,
  reviewCard,
  getCardState,
} from './collections';
import { settingsStore } from './settings-store';
import { type Grade, isDue, isNew } from '../utils/fsrs';

const NEW_CARD_COUNT_KEY = 'flash-card-new-count';

interface NewCardTracker {
  date: string;
  count: number;
}

export interface ReviewableCard {
  id: string; // e.g. "hola" or "hola:reverse"
  deckName: string;
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  isReverse: boolean;
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function getNewCardCount(): number {
  try {
    const raw = localStorage.getItem(NEW_CARD_COUNT_KEY);
    if (!raw) return 0;
    const tracker: NewCardTracker = JSON.parse(raw);
    if (tracker.date !== getTodayKey()) return 0;
    return tracker.count;
  } catch {
    return 0;
  }
}

function incrementNewCardCount(n: number): void {
  const current = getNewCardCount();
  localStorage.setItem(
    NEW_CARD_COUNT_KEY,
    JSON.stringify({ date: getTodayKey(), count: current + n }),
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Get all reviewable cards for a deck (including reverse cards)
async function getReviewableCards(deckName: string): Promise<ReviewableCard[]> {
  // Wait for cards to be loaded from GitHub
  const cards = await cardsCollection.toArrayWhenReady();
  const deckCards = cards.filter((c) => c.deckName === deckName);
  const result: ReviewableCard[] = [];

  for (const card of deckCards) {
    // card.id should be "deckName/cardId", extract just the cardId part
    const cardId = card.id?.includes('/') ? card.id.split('/')[1] : card.id;
    if (!cardId) {
      console.error('Card missing id:', card);
      continue;
    }
    result.push({
      id: cardId,
      deckName,
      source: card.source,
      translation: card.translation,
      example: card.example,
      notes: card.notes,
      isReverse: false,
    });

    if (card.reversible) {
      result.push({
        id: `${cardId}:reverse`,
        deckName,
        source: card.translation,
        translation: card.source,
        example: card.example,
        notes: card.notes,
        isReverse: true,
      });
    }
  }

  return result;
}

async function getDueCards(deckName: string): Promise<ReviewableCard[]> {
  const cards = await getReviewableCards(deckName);
  // Also wait for states to be ready
  await cardStatesCollection.toArrayWhenReady();
  return cards.filter((c) => {
    const state = getCardState(deckName, c.id);
    return !state.suspended && !isNew(state) && isDue(state);
  });
}

async function getNewCards(deckName: string): Promise<ReviewableCard[]> {
  const cards = await getReviewableCards(deckName);
  // Also wait for states to be ready
  await cardStatesCollection.toArrayWhenReady();
  return cards.filter((c) => {
    const state = getCardState(deckName, c.id);
    return !state.suspended && isNew(state);
  });
}

export interface ReviewSessionState {
  cards: ReviewableCard[];
  currentIndex: number;
  answerRevealed: boolean;
  done: number;
  total: number;
  version: number; // Incremented on each change to ensure React detects updates
}

let session: ReviewSessionState | null = null;
let deckName = '';
let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach((l) => l());
}

export const reviewSession = {
  subscribe(listener: () => void): () => void {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },

  async start(deck: string): Promise<void> {
    deckName = deck;
    const settings = settingsStore.get();
    const limit = settings.newCardsPerDay;
    const usedToday = getNewCardCount();
    const newBudget = Math.max(0, limit - usedToday);

    const dueCards = shuffle(await getDueCards(deck));
    const newCards = shuffle(await getNewCards(deck)).slice(0, newBudget);

    // Interleave: 1 new card per 5 due cards
    const ordered: ReviewableCard[] = [];
    let dueIdx = 0;
    let newIdx = 0;
    let sinceLast = 0;

    while (dueIdx < dueCards.length || newIdx < newCards.length) {
      if (dueIdx < dueCards.length && (sinceLast < 5 || newIdx >= newCards.length)) {
        ordered.push(dueCards[dueIdx++]);
        sinceLast++;
      } else if (newIdx < newCards.length) {
        ordered.push(newCards[newIdx++]);
        sinceLast = 0;
      }
    }

    session = {
      cards: ordered,
      currentIndex: 0,
      answerRevealed: false,
      done: 0,
      total: ordered.length,
      version: 0,
    };
    notify();
  },

  async addMoreNewCards(): Promise<void> {
    if (!session) return;
    const settings = settingsStore.get();
    const batch = settings.newCardsPerDay;
    const allNew = shuffle(await getNewCards(deckName));
    const currentIds = new Set(session.cards.map((c) => c.id));
    const additional = allNew.filter((c) => !currentIds.has(c.id)).slice(0, batch);

    const newCards = [...session.cards, ...additional];
    session = {
      ...session,
      cards: newCards,
      total: newCards.length,
      version: session.version + 1,
    };
    notify();
  },

  getState(): ReviewSessionState | null {
    return session;
  },

  getCurrentCard(): ReviewableCard | null {
    if (!session || session.currentIndex >= session.cards.length) return null;
    return session.cards[session.currentIndex];
  },

  showAnswer(): void {
    if (!session) return;
    session = { ...session, answerRevealed: true, version: session.version + 1 };
    notify();
  },

  rate(rating: Grade): void {
    if (!session) return;
    const card = this.getCurrentCard();
    if (!card) return;

    const state = reviewCard(deckName, card.id, rating);

    // Track new card usage
    if (state.reps === 1) {
      incrementNewCardCount(1);
    }

    session = {
      ...session,
      done: session.done + 1,
      currentIndex: session.currentIndex + 1,
      answerRevealed: false,
      version: session.version + 1,
    };
    notify();
  },

  skip(): void {
    if (!session) return;
    session = {
      ...session,
      currentIndex: session.currentIndex + 1,
      answerRevealed: false,
      version: session.version + 1,
    };
    notify();
  },

  isActive(): boolean {
    return session !== null && session.currentIndex < session.cards.length;
  },

  isComplete(): boolean {
    return session !== null && session.currentIndex >= session.cards.length;
  },

  end(): void {
    session = null;
    notify();
  },

  getDeckName(): string {
    return deckName;
  },

  // Expose these for components that need them
  getCardState,
};
