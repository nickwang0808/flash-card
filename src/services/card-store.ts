import { githubApi, parseRepoUrl, type GitHubConfig } from './github-api';
import { settingsStore } from './settings-store';
import {
  type CardState,
  createNewCardState,
  reviewCard as fsrsReview,
  isDue,
  isNew,
  ratingName,
  type Grade,
} from '../utils/fsrs';

export interface CardData {
  id: string;
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
}

export interface ReviewableCard {
  id: string; // e.g. "hola" or "hola:reverse"
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  isReverse: boolean;
  deckName: string;
}

const PENDING_KEY = 'flash-card-pending-reviews';

export interface PendingReview {
  deckName: string;
  cardId: string;
  state: CardState;
  commitMessage: string;
}

interface DeckData {
  name: string;
  cards: Record<string, CardData>;
  state: Record<string, CardState>;
}

let decks: DeckData[] = [];

function getConfig(): GitHubConfig {
  const s = settingsStore.get();
  const { owner, repo } = parseRepoUrl(s.repoUrl);
  return { owner, repo, token: s.token };
}

function getPendingReviews(): PendingReview[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setPendingReviews(reviews: PendingReview[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(reviews));
}

export const cardStore = {
  async loadDeck(deckName: string): Promise<void> {
    const config = getConfig();

    let cardsRaw: string;
    try {
      const result = await githubApi.readFile(config, `${deckName}/cards.json`);
      cardsRaw = result.content;
    } catch {
      return; // no cards.json = not a deck
    }

    let stateRaw = '{}';
    try {
      const result = await githubApi.readFile(config, `${deckName}/state.json`);
      stateRaw = result.content;
    } catch {
      // no state.json yet, that's fine
    }

    const cards: Record<string, CardData> = JSON.parse(cardsRaw);
    const state: Record<string, CardState> = JSON.parse(stateRaw);

    // Apply pending reviews
    const pending = getPendingReviews();
    for (const p of pending) {
      if (p.deckName === deckName) {
        state[p.cardId] = p.state;
      }
    }

    // Initialize missing states
    for (const id of Object.keys(cards)) {
      if (!state[id]) {
        state[id] = createNewCardState();
      }
      if (cards[id].reversible && !state[`${id}:reverse`]) {
        state[`${id}:reverse`] = createNewCardState();
      }
    }

    const idx = decks.findIndex((d) => d.name === deckName);
    const deck: DeckData = { name: deckName, cards, state };
    if (idx >= 0) decks[idx] = deck;
    else decks.push(deck);
  },

  async loadAllDecks(): Promise<void> {
    const config = getConfig();
    const entries = await githubApi.listDirectory(config, '');
    const dirs = entries.filter(e => e.type === 'dir' && !e.name.startsWith('.')).map(e => e.name);
    decks = [];
    for (const dir of dirs) {
      await this.loadDeck(dir);
    }
  },

  getDeckNames(): string[] {
    return decks.map((d) => d.name);
  },

  getReviewableCards(deckName: string): ReviewableCard[] {
    const deck = decks.find((d) => d.name === deckName);
    if (!deck) return [];

    const result: ReviewableCard[] = [];
    for (const [id, card] of Object.entries(deck.cards)) {
      result.push({
        id,
        source: card.source,
        translation: card.translation,
        example: card.example,
        notes: card.notes,
        isReverse: false,
        deckName,
      });
      if (card.reversible) {
        result.push({
          id: `${id}:reverse`,
          source: card.translation,
          translation: card.source,
          example: card.example,
          notes: card.notes,
          isReverse: true,
          deckName,
        });
      }
    }
    return result;
  },

  getState(deckName: string, cardId: string): CardState {
    const deck = decks.find((d) => d.name === deckName);
    if (!deck || !deck.state[cardId]) return createNewCardState();
    return deck.state[cardId];
  },

  getDueCards(deckName: string): ReviewableCard[] {
    const cards = this.getReviewableCards(deckName);
    return cards.filter((c) => {
      const state = this.getState(deckName, c.id);
      return !state.suspended && !isNew(state) && isDue(state);
    });
  },

  getNewCards(deckName: string): ReviewableCard[] {
    const cards = this.getReviewableCards(deckName);
    return cards.filter((c) => {
      const state = this.getState(deckName, c.id);
      return !state.suspended && isNew(state);
    });
  },

  getDueCount(deckName: string): number {
    return this.getDueCards(deckName).length;
  },

  getNewCount(deckName: string): number {
    return this.getNewCards(deckName).length;
  },

  review(deckName: string, cardId: string, rating: Grade): CardState {
    const deck = decks.find((d) => d.name === deckName);
    if (!deck) throw new Error(`Deck not found: ${deckName}`);

    const current = deck.state[cardId] ?? createNewCardState();
    const updated = fsrsReview(current, rating);
    deck.state[cardId] = updated;

    // Queue pending review
    const msg = `review: ${cardId} (${ratingName(rating)}) — next due ${updated.due.split('T')[0]}`;
    const pending = getPendingReviews();
    pending.push({ deckName, cardId, state: updated, commitMessage: msg });
    setPendingReviews(pending);

    return updated;
  },

  getPendingCount(): number {
    return getPendingReviews().length;
  },

  hasPendingReviews(): boolean {
    return getPendingReviews().length > 0;
  },

  getPendingReviews,
  setPendingReviews,
};
