import { type Card } from 'ts-fsrs';
import { github, getConfig } from './github';
import { settingsStore } from './settings-store';
import type { FlashCard } from './collections';

// JSON representation of Card (dates as strings)
interface CardStateJSON {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

// JSON representation of FlashCard in storage
interface FlashCardJSON {
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
  state?: CardStateJSON;         // source → translation
  reverseState?: CardStateJSON;  // translation → source
}

function parseCardState(json: CardStateJSON): Card {
  return {
    ...json,
    due: new Date(json.due),
    last_review: json.last_review ? new Date(json.last_review) : undefined,
  } as Card;
}

function serializeCardState(card: Card): CardStateJSON {
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

function isConfigured(): boolean {
  return settingsStore.isConfigured();
}


export const githubService = {
  /**
   * List all decks (directories containing cards.json).
   */
  async listDecks(): Promise<string[]> {
    if (!isConfigured()) return [];

    const config = getConfig();

    try {
      const entries = await github.listDirectory(config, '');
      const decks: string[] = [];

      for (const entry of entries) {
        if (entry.type === 'dir') {
          try {
            // Check if directory has cards.json
            await github.readFile(config, `${entry.name}/cards.json`);
            decks.push(entry.name);
          } catch {
            // No cards.json, not a deck
          }
        }
      }

      return decks;
    } catch {
      return [];
    }
  },

  /**
   * Get cards with content + state for a specific deck.
   */
  async getCards(deckName: string): Promise<FlashCard[]> {
    if (!isConfigured()) return [];

    const config = getConfig();

    try {
      const { content } = await github.readFile(config, `${deckName}/cards.json`);
      const cards: Record<string, FlashCardJSON> = JSON.parse(content);

      return Object.values(cards).map((card) => ({
        source: card.source,
        translation: card.translation,
        example: card.example,
        notes: card.notes,
        tags: card.tags,
        created: card.created,
        reversible: card.reversible,
        state: card.state ? parseCardState(card.state) : undefined,
        reverseState: card.reverseState ? parseCardState(card.reverseState) : undefined,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Update cards (content + state) for a specific deck.
   */
  async updateCards(deckName: string, cards: FlashCard[]): Promise<void> {
    const config = getConfig();

    let existing: Record<string, FlashCardJSON> = {};
    let sha: string | undefined;

    try {
      const result = await github.readFile(config, `${deckName}/cards.json`);
      existing = JSON.parse(result.content);
      sha = result.sha;
    } catch {
      // file doesn't exist yet
    }

    for (const card of cards) {
      existing[card.source] = {
        source: card.source,
        translation: card.translation,
        example: card.example,
        notes: card.notes,
        tags: card.tags,
        created: card.created,
        reversible: card.reversible,
        state: card.state ? serializeCardState(card.state) : undefined,
        reverseState: card.reverseState ? serializeCardState(card.reverseState) : undefined,
      };
    }

    await github.writeFile(
      config,
      `${deckName}/cards.json`,
      JSON.stringify(existing, null, 2),
      sha,
      `update: ${cards.length} card(s)`,
    );
  },
};
