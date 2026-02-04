import { type Card } from 'ts-fsrs';
import pDebounce from 'p-debounce';
import { github, parseRepoUrl, type GitHubConfig } from './github';
import { settingsCollection, defaultSettings } from '../hooks/useSettings';
import type { FlashCard } from './collections';

const BATCH_DELAY_MS = 5000;

// Accumulator: pending card updates per deck
const pendingUpdates = new Map<string, Map<string, FlashCard>>();

// Get or create pending updates map for a deck
function getPendingUpdates(deckName: string): Map<string, FlashCard> {
  if (!pendingUpdates.has(deckName)) {
    pendingUpdates.set(deckName, new Map());
  }
  return pendingUpdates.get(deckName)!;
}

// Get config from settings collection
function getConfig(): GitHubConfig {
  const settings = settingsCollection.state.get('settings') ?? defaultSettings;
  const { owner, repo } = parseRepoUrl(settings.repoUrl);
  return { owner, repo, token: settings.token, branch: settings.branch };
}

function isConfigured(): boolean {
  const settings = settingsCollection.state.get('settings') ?? defaultSettings;
  return settings.repoUrl.length > 0 && settings.token.length > 0;
}

// JSON representation of Card (dates as strings)
interface CardStateJSON extends Omit<Card, 'due' | 'last_review'> {
  due: string;
  last_review?: string;
}

// JSON representation of FlashCard in storage
interface FlashCardJSON extends Omit<FlashCard, 'state' | 'reverseState'> {
  state: CardStateJSON | null;
  reverseState: CardStateJSON | null;
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

// Core write function (not debounced)
async function writeCardsToGitHub(deckName: string): Promise<void> {
  const pending = pendingUpdates.get(deckName);
  if (!pending || pending.size === 0) return;

  const cards = Array.from(pending.values());
  pending.clear();

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
      state: card.state ? serializeCardState(card.state) : null,
      reverseState: card.reverseState ? serializeCardState(card.reverseState) : null,
    };
  }

  await github.writeFile(
    config,
    `${deckName}/cards.json`,
    JSON.stringify(existing, null, 2),
    sha,
    `review: ${deckName} - ${cards.map(c => c.source).join(', ')}`,
  );
}

// Debounced flush per deck (created lazily)
const debouncedFlushers = new Map<string, () => Promise<void>>();

function getDebouncedFlush(deckName: string): () => Promise<void> {
  if (!debouncedFlushers.has(deckName)) {
    debouncedFlushers.set(
      deckName,
      pDebounce(() => writeCardsToGitHub(deckName), BATCH_DELAY_MS)
    );
  }
    return debouncedFlushers.get(deckName)!;
}

export const githubService = {
  getConfig,
  isConfigured,

  async listDecks(): Promise<string[]> {
    if (!isConfigured()) return [];

    const config = getConfig();

    try {
      const entries = await github.listDirectory(config, '');
      const decks: string[] = [];

      for (const entry of entries) {
        if (entry.type === 'dir') {
          try {
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
        state: card.state ? parseCardState(card.state) : null,
        reverseState: card.reverseState ? parseCardState(card.reverseState) : null,
      }));
    } catch {
      return [];
    }
  },

  async updateCards(deckName: string, cards: FlashCard[]): Promise<void> {
    const pending = getPendingUpdates(deckName);
    for (const card of cards) {
      pending.set(card.source, card); // Latest update wins
    }
    return getDebouncedFlush(deckName)();
  },
};
