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
  state?: CardStateJSON;
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
   * Get cards with content + state for a specific deck.
   */
  async getCards(deckName: string): Promise<FlashCard[]> {
    if (!isConfigured()) return [];

    const config = getConfig();

    try {
      const { content } = await github.readFile(config, `${deckName}/cards.json`);
      const cards: Record<string, FlashCardJSON> = JSON.parse(content);

      return Object.entries(cards).map(([cardId, card]) => ({
        id: `${deckName}/${cardId}`,
        deckName,
        source: card.source,
        translation: card.translation,
        example: card.example,
        notes: card.notes,
        tags: card.tags,
        created: card.created,
        reversible: card.reversible,
        state: card.state ? parseCardState(card.state) : undefined,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Update cards (content + state). Groups updates by deck and writes to cards.json.
   */
  async updateCards(cards: FlashCard[]): Promise<void> {
    const config = getConfig();

    // Group by deck
    const byDeck = new Map<string, FlashCard[]>();
    for (const card of cards) {
      const list = byDeck.get(card.deckName) || [];
      list.push(card);
      byDeck.set(card.deckName, list);
    }

    // Write each deck's cards.json
    for (const [deckName, deckCards] of byDeck) {
      let existing: Record<string, FlashCardJSON> = {};
      let sha: string | undefined;

      try {
        const result = await github.readFile(config, `${deckName}/cards.json`);
        existing = JSON.parse(result.content);
        sha = result.sha;
      } catch {
        // file doesn't exist yet
      }

      for (const card of deckCards) {
        const cardId = card.id.split('/')[1]; // Extract cardId from "deckName/cardId"
        existing[cardId] = {
          source: card.source,
          translation: card.translation,
          example: card.example,
          notes: card.notes,
          tags: card.tags,
          created: card.created,
          reversible: card.reversible,
          state: card.state ? serializeCardState(card.state) : undefined,
        };
      }

      await github.writeFile(
        config,
        `${deckName}/cards.json`,
        JSON.stringify(existing, null, 2),
        sha,
        `update: ${deckCards.length} card(s)`,
      );
    }
  },
};
