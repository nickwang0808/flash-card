import { gitService } from './git-service';
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

const WAL_KEY = 'flash-card-wal'; // write-ahead log

interface DeckData {
  name: string;
  cards: Record<string, CardData>;
  state: Record<string, CardState>;
}

let decks: DeckData[] = [];

function getWAL(): Record<string, Record<string, CardState>> {
  try {
    const raw = localStorage.getItem(WAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setWAL(wal: Record<string, Record<string, CardState>>): void {
  localStorage.setItem(WAL_KEY, JSON.stringify(wal));
}

function clearDeckWAL(deckName: string): void {
  const wal = getWAL();
  delete wal[deckName];
  setWAL(wal);
}

function writeDeckWAL(deckName: string, cardId: string, state: CardState): void {
  const wal = getWAL();
  if (!wal[deckName]) wal[deckName] = {};
  wal[deckName][cardId] = state;
  setWAL(wal);
}

export const cardStore = {
  async loadDeck(deckName: string): Promise<void> {
    let cardsRaw: string;
    try {
      cardsRaw = await gitService.readFile(`${deckName}/cards.json`);
    } catch {
      return; // no cards.json = not a deck
    }

    let stateRaw = '{}';
    try {
      stateRaw = await gitService.readFile(`${deckName}/state.json`);
    } catch {
      // no state.json yet, that's fine
    }

    const cards: Record<string, CardData> = JSON.parse(cardsRaw);
    const state: Record<string, CardState> = JSON.parse(stateRaw);

    // Apply WAL entries
    const wal = getWAL();
    if (wal[deckName]) {
      Object.assign(state, wal[deckName]);
    }

    // Initialize missing states
    for (const id of Object.keys(cards)) {
      if (!state[id]) {
        state[id] = createNewCardState();
      }
      // Generate reverse card state if reversible
      if (cards[id].reversible && !state[`${id}:reverse`]) {
        state[`${id}:reverse`] = createNewCardState();
      }
    }

    // Replace or add deck
    const idx = decks.findIndex((d) => d.name === deckName);
    const deck: DeckData = { name: deckName, cards, state };
    if (idx >= 0) decks[idx] = deck;
    else decks.push(deck);
  },

  async loadAllDecks(): Promise<void> {
    const dirs = await gitService.listDirectories();
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

    // Write-ahead to localStorage
    writeDeckWAL(deckName, cardId, updated);

    return updated;
  },

  async save(deckName: string): Promise<void> {
    const deck = decks.find((d) => d.name === deckName);
    if (!deck) return;

    await gitService.writeFile(
      `${deckName}/state.json`,
      JSON.stringify(deck.state, null, 2),
    );
    clearDeckWAL(deckName);
  },

  async commitReview(deckName: string, cardId: string, rating: Grade, nextDue: string): Promise<void> {
    await this.save(deckName);
    const msg = `review: ${cardId} (${ratingName(rating)}) — next due ${nextDue.split('T')[0]}`;
    await gitService.commit(msg);
  },

  hasWALEntries(): boolean {
    const wal = getWAL();
    return Object.keys(wal).length > 0;
  },

  async recoverFromWAL(): Promise<void> {
    const wal = getWAL();
    for (const deckName of Object.keys(wal)) {
      const deck = decks.find((d) => d.name === deckName);
      if (deck) {
        Object.assign(deck.state, wal[deckName]);
        await this.save(deckName);
        await gitService.commit(`recover: apply ${Object.keys(wal[deckName]).length} pending reviews for ${deckName}`);
      }
    }
    localStorage.removeItem(WAL_KEY);
  },
};
