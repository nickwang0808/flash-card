import type { GitStorageService } from './git-storage';
import { GitHubStorageService, parseRepoUrl, type GitHubConfig } from './github';
import { defaultSettings } from '../hooks/useSettings';
import { getDatabaseSync } from './rxdb';
import { getCardRepository } from './card-repository';

// --- Config helpers ---

export async function getConfig(): Promise<GitHubConfig> {
  const db = getDatabaseSync();
  const doc = await db.settings.findOne('settings').exec();
  const settings = doc ? doc.toJSON() : defaultSettings;
  const { owner, repo } = parseRepoUrl(settings.repoUrl);
  return {
    owner,
    repo,
    token: settings.token,
    branch: settings.branch,
    baseUrl: settings.apiBaseUrl || undefined,
  };
}

async function isConfigured(): Promise<boolean> {
  const db = getDatabaseSync();
  const doc = await db.settings.findOne('settings').exec();
  const settings = doc ? doc.toJSON() : defaultSettings;
  return settings.repoUrl.length > 0 && settings.token.length > 0;
}

// --- Service factory for injection ---

let serviceFactory: (() => Promise<GitStorageService>) | null = null;

export function setServiceFactory(factory: () => Promise<GitStorageService>) {
  serviceFactory = factory;
}

async function getService(): Promise<GitStorageService> {
  if (serviceFactory) return serviceFactory();
  const config = await getConfig();
  return new GitHubStorageService(config);
}

// --- Sync state ---

let syncInProgress: Promise<void> | null = null;

// --- Debounce-based push ---

const dirtyCardIds = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 10_000;
const MAX_BATCH_SIZE = 10;

async function pushDirtyCards(ids: string[]): Promise<void> {
  if (!(await isConfigured()) || !navigator.onLine) return;

  const service = await getService();
  const repo = getCardRepository();
  const cards = await repo.getCardDataByIds(ids);

  if (cards.length > 0) await service.pushCards(cards);
}

function flushChanges(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (syncInProgress) {
    syncInProgress.finally(() => {
      if (dirtyCardIds.size > 0) flushChanges();
    });
    return;
  }

  if (dirtyCardIds.size === 0) return;

  const ids = [...dirtyCardIds];
  dirtyCardIds.clear();
  pushDirtyCards(ids).catch(() => {});
}

export function notifyChange(cardId: string): void {
  dirtyCardIds.add(cardId);
  if (dirtyCardIds.size >= MAX_BATCH_SIZE) {
    flushChanges();
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushChanges, DEBOUNCE_MS);
}

export function flushSync(): void {
  if (dirtyCardIds.size > 0) {
    flushChanges();
  }
}

// --- Full sync ---

export async function runSync(): Promise<void> {
  if (!(await isConfigured()) || !navigator.onLine) return;

  if (syncInProgress) return syncInProgress;

  syncInProgress = doSync();
  try {
    await syncInProgress;
  } finally {
    syncInProgress = null;
  }
}

async function doSync(): Promise<void> {
  const service = await getService();
  const repo = getCardRepository();

  // Flush any pending pushes first (so we don't lose them)
  if (dirtyCardIds.size > 0) {
    const ids = [...dirtyCardIds];
    dirtyCardIds.clear();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await pushDirtyCards(ids);
  }

  // Pull: bulk replace
  const cards = await service.pullAllCards();
  await repo.replaceAll(cards);
}

export async function cancelSync(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  dirtyCardIds.clear();
}
