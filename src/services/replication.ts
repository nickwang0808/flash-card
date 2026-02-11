import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication';
import { type RxCollection } from 'rxdb/plugins/core';
import { type Card } from 'ts-fsrs';
import { github, parseRepoUrl, type GitHubConfig } from './github';
import { settingsCollection, defaultSettings } from '../hooks/useSettings';
import type { FlashCard } from './collections';
import { type CardDoc, type AppDatabase } from './rxdb';

// --- Config helpers (moved from github-service.ts) ---

function getConfig(): GitHubConfig {
  const settings = settingsCollection.state.get('settings') ?? defaultSettings;
  const { owner, repo } = parseRepoUrl(settings.repoUrl);
  return { owner, repo, token: settings.token, branch: settings.branch };
}

function isConfigured(): boolean {
  const settings = settingsCollection.state.get('settings') ?? defaultSettings;
  return settings.repoUrl.length > 0 && settings.token.length > 0;
}

// --- Composite key helpers ---

export function makeCardId(deckName: string, source: string): string {
  return `${deckName}|${source}`;
}

export function parseCardId(id: string): { deckName: string; source: string } {
  const idx = id.indexOf('|');
  if (idx === -1) return { deckName: '', source: id };
  return { deckName: id.slice(0, idx), source: id.slice(idx + 1) };
}

// --- Date serialization for FSRS Card objects ---

interface CardStateJSON extends Omit<Card, 'due' | 'last_review'> {
  due: string;
  last_review?: string;
}

interface FlashCardJSON extends Omit<FlashCard, 'state' | 'reverseState' | 'id' | 'deckName'> {
  state: CardStateJSON | null;
  reverseState: CardStateJSON | null;
}

export function parseCardState(json: CardStateJSON): Card {
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

// RxDB doc type with _deleted field required by replication
type CardDocWithDeleted = CardDoc & { _deleted: boolean };

// Serialize a FlashCard's state fields for storage in GitHub JSON
function serializeCardForGitHub(card: CardDocWithDeleted): FlashCardJSON {
  return {
    source: card.source,
    translation: card.translation,
    example: card.example,
    notes: card.notes,
    tags: card.tags,
    created: card.created,
    reversible: card.reversible,
    state: card.state ? serializeCardState(card.state as unknown as Card) : null,
    reverseState: card.reverseState ? serializeCardState(card.reverseState as unknown as Card) : null,
    suspended: card.suspended,
  };
}

// --- Pull handler: fetch all cards from GitHub ---

async function pullHandler(
  lastCheckpoint: { done: boolean } | undefined,
  _batchSize: number,
): Promise<{ documents: CardDocWithDeleted[]; checkpoint: { done: boolean } | undefined }> {
  if (!isConfigured()) {
    return { documents: [], checkpoint: lastCheckpoint };
  }

  const config = getConfig();
  const allCards: CardDocWithDeleted[] = [];

  try {
    const entries = await github.listDirectory(config, '');

    for (const entry of entries) {
      if (entry.type !== 'dir') continue;
      try {
        const { content } = await github.readFile(config, `${entry.name}/cards.json`);
        const cardsMap: Record<string, FlashCardJSON> = JSON.parse(content);

        for (const card of Object.values(cardsMap)) {
          allCards.push({
            id: makeCardId(entry.name, card.source),
            deckName: entry.name,
            source: card.source,
            translation: card.translation,
            example: card.example ?? '',
            notes: card.notes ?? '',
            tags: card.tags ?? [],
            created: card.created,
            reversible: card.reversible ?? false,
            state: card.state as Record<string, unknown> | null,
            reverseState: card.reverseState as Record<string, unknown> | null,
            suspended: card.suspended ?? false,
            _deleted: false,
          });
        }
      } catch {
        // Not a deck directory or no cards.json — skip
      }
    }
  } catch {
    // Network error — return empty, will retry next sync
    return { documents: [], checkpoint: lastCheckpoint };
  }

  return {
    documents: allCards,
    checkpoint: allCards.length > 0 ? { done: true } : lastCheckpoint,
  };
}

// --- Push handler: group by deck, read-merge-write per deck ---

async function pushHandler(
  docs: Array<{
    newDocumentState: CardDocWithDeleted;
    assumedMasterState?: CardDocWithDeleted;
  }>,
): Promise<CardDocWithDeleted[]> {
  const config = getConfig();

  // Group changes by deck
  const byDeck = new Map<string, CardDocWithDeleted[]>();
  for (const { newDocumentState } of docs) {
    const deck = newDocumentState.deckName;
    if (!byDeck.has(deck)) byDeck.set(deck, []);
    byDeck.get(deck)!.push(newDocumentState);
  }

  // Write each deck's changes to GitHub
  for (const [deckName, cards] of byDeck) {
    let existing: Record<string, FlashCardJSON> = {};
    let sha: string | undefined;

    try {
      const result = await github.readFile(config, `${deckName}/cards.json`);
      existing = JSON.parse(result.content);
      sha = result.sha;
    } catch {
      // New deck, file doesn't exist yet
    }

    for (const card of cards) {
      if (card._deleted) {
        delete existing[card.source];
      } else {
        existing[card.source] = serializeCardForGitHub(card);
      }
    }

    await github.writeFile(
      config,
      `${deckName}/cards.json`,
      JSON.stringify(existing, null, 2),
      sha,
      `sync: ${deckName} - ${cards.map((c) => c.source).join(', ')}`,
    );
  }

  return []; // No conflicts (last-write-wins)
}

// --- Decks sync: derive from cards after pull ---

async function syncDecks(db: AppDatabase): Promise<void> {
  const allCards = await db.cards.find().exec();
  const deckNames = new Set(allCards.map((c) => c.deckName));

  const currentDecks = await db.decks.find().exec();
  const currentDeckNames = new Set(currentDecks.map((d) => d.name));

  // Insert new decks
  for (const name of deckNames) {
    if (!currentDeckNames.has(name)) {
      await db.decks.insert({ name });
    }
  }
  // Remove deleted decks
  for (const deck of currentDecks) {
    if (!deckNames.has(deck.name)) {
      await deck.remove();
    }
  }
}

// --- Replication state management ---

let replicationState: RxReplicationState<CardDoc, unknown> | null = null;
let database: AppDatabase | null = null;

export function setupReplication(db: AppDatabase): void {
  database = db;
  replicationState = replicateRxCollection({
    collection: db.cards as unknown as RxCollection<CardDoc>,
    replicationIdentifier: 'github-cards-sync',
    live: false,
    autoStart: false,
    pull: { handler: pullHandler as any, batchSize: 500 },
    push: { handler: pushHandler as any, batchSize: 100 },
  });
}

export async function runSync(): Promise<void> {
  if (!replicationState || !database) {
    throw new Error('Replication not initialized');
  }

  // Start replication (pull + push), then wait for completion
  if (replicationState.isStopped()) {
    // Re-create if stopped
    setupReplication(database);
  }
  await replicationState!.start();
  await replicationState!.awaitInSync();
  await replicationState!.cancel();

  // Sync decks collection from cards
  await syncDecks(database);
}

export async function cancelReplication(): Promise<void> {
  if (replicationState) {
    if (!replicationState.isStopped()) {
      await replicationState.cancel();
    }
    replicationState = null;
    database = null;
  }
}
