import { cardStore, type ReviewableCard } from './card-store';
import { settingsStore } from './settings-store';
import { type Grade } from '../utils/fsrs';

const NEW_CARD_COUNT_KEY = 'flash-card-new-count';

interface NewCardTracker {
  date: string;
  count: number;
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

export interface ReviewSessionState {
  cards: ReviewableCard[];
  currentIndex: number;
  answerRevealed: boolean;
  done: number;
  total: number;
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

  start(deck: string): void {
    deckName = deck;
    const settings = settingsStore.get();
    const limit = settings.newCardsPerDay;
    const usedToday = getNewCardCount();
    const newBudget = Math.max(0, limit - usedToday);

    const dueCards = shuffle(cardStore.getDueCards(deck));
    const newCards = shuffle(cardStore.getNewCards(deck)).slice(0, newBudget);

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
    };
    notify();
  },

  addMoreNewCards(): void {
    if (!session) return;
    const settings = settingsStore.get();
    const batch = settings.newCardsPerDay;
    const allNew = shuffle(cardStore.getNewCards(deckName));
    const currentIds = new Set(session.cards.map((c) => c.id));
    const additional = allNew.filter((c) => !currentIds.has(c.id)).slice(0, batch);

    session.cards.push(...additional);
    session.total = session.cards.length;
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
    session.answerRevealed = true;
    notify();
  },

  async rate(rating: Grade): Promise<void> {
    if (!session) return;
    const card = this.getCurrentCard();
    if (!card) return;

    const state = cardStore.review(deckName, card.id, rating);

    // Track new card usage
    if (state.reps === 1) {
      incrementNewCardCount(1);
    }

    // Commit per card
    await cardStore.commitReview(deckName, card.id, rating, state.due);

    session.done++;
    session.currentIndex++;
    session.answerRevealed = false;
    notify();
  },

  skip(): void {
    if (!session) return;
    session.currentIndex++;
    session.answerRevealed = false;
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
};
