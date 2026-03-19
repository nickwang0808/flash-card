import { supabase } from './supabase';
import { SupabaseStorageService } from './supabase-storage';
import { getCardRepository } from './card-repository';
import type { StoredReviewLog } from './review-log-repository';
import { getDatabaseSync } from './rxdb';
import { defaultSettings } from '../hooks/useSettings';

// --- Supabase storage service (singleton) ---

let storageService: SupabaseStorageService | null = null;

function getStorage(): SupabaseStorageService {
  if (!storageService) {
    storageService = new SupabaseStorageService(supabase);
  }
  return storageService;
}

// Allow injection for testing
export function setStorageService(service: SupabaseStorageService | null): void {
  storageService = service;
}

// --- Auth check ---

async function isConfigured(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

// --- Sync state ---

let syncInProgress: Promise<void> | null = null;

// --- Debounce-based push ---

const dirtyCardIds = new Set<string>();
const dirtyReviewLogIds = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 10_000;
const MAX_BATCH_SIZE = 10;

async function pushDirtyCards(ids: string[]): Promise<void> {
  if (!(await isConfigured()) || !navigator.onLine) return;

  const storage = getStorage();
  const repo = getCardRepository();
  const cards = await repo.getCardDataByIds(ids);

  if (cards.length > 0) await storage.pushCards(cards);
}

async function pushDirtyReviewLogs(ids: string[]): Promise<void> {
  if (!(await isConfigured()) || !navigator.onLine) return;

  const storage = getStorage();
  const db = getDatabaseSync();

  const logs: StoredReviewLog[] = [];
  for (const id of ids) {
    const doc = await db.reviewlogs.findOne(id).exec();
    if (doc) logs.push(doc.toJSON() as unknown as StoredReviewLog);
  }

  if (logs.length > 0) await storage.pushReviewLogs(logs);
}

function flushChanges(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (syncInProgress) {
    syncInProgress.finally(() => {
      if (dirtyCardIds.size > 0 || dirtyReviewLogIds.size > 0) flushChanges();
    });
    return;
  }

  const cardIds = [...dirtyCardIds];
  const logIds = [...dirtyReviewLogIds];
  dirtyCardIds.clear();
  dirtyReviewLogIds.clear();

  if (cardIds.length === 0 && logIds.length === 0) return;

  Promise.all([
    cardIds.length > 0 ? pushDirtyCards(cardIds) : Promise.resolve(),
    logIds.length > 0 ? pushDirtyReviewLogs(logIds) : Promise.resolve(),
  ]).catch(() => {});
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

export function notifyReviewLogChange(logId: string): void {
  dirtyReviewLogIds.add(logId);
  if (dirtyReviewLogIds.size >= MAX_BATCH_SIZE) {
    flushChanges();
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushChanges, DEBOUNCE_MS);
}

export async function notifySettingsChange(): Promise<void> {
  if (!(await isConfigured()) || !navigator.onLine) return;

  const storage = getStorage();
  const db = getDatabaseSync();
  const doc = await db.settings.findOne('settings').exec();
  if (!doc) return;

  const s = doc.toJSON();
  await storage.pushSettings({
    id: 'settings',
    newCardsPerDay: s.newCardsPerDay,
    reviewOrder: s.reviewOrder,
    theme: s.theme,
  });
}

export function flushSync(): void {
  if (dirtyCardIds.size > 0 || dirtyReviewLogIds.size > 0) {
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
  const storage = getStorage();
  const repo = getCardRepository();

  // Flush any pending pushes first
  if (dirtyCardIds.size > 0 || dirtyReviewLogIds.size > 0) {
    const cardIds = [...dirtyCardIds];
    const logIds = [...dirtyReviewLogIds];
    dirtyCardIds.clear();
    dirtyReviewLogIds.clear();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await Promise.all([
      cardIds.length > 0 ? pushDirtyCards(cardIds) : Promise.resolve(),
      logIds.length > 0 ? pushDirtyReviewLogs(logIds) : Promise.resolve(),
    ]);
  }

  // Pull cards
  const cards = await storage.pullAllCards();
  await repo.replaceAll(cards);

  // Pull review logs
  const remoteLogs = await storage.pullReviewLogs();
  const db = getDatabaseSync();
  await db.reviewlogs.find().remove();
  if (remoteLogs.length > 0) {
    await db.reviewlogs.bulkInsert(remoteLogs.map((log) => ({
      id: log.id,
      cardId: log.cardId,
      isReverse: log.isReverse,
      rating: log.rating,
      state: log.state,
      due: log.due,
      stability: log.stability,
      difficulty: log.difficulty,
      elapsed_days: log.elapsed_days,
      last_elapsed_days: log.last_elapsed_days,
      scheduled_days: log.scheduled_days,
      review: log.review,
    })));
  }

  // Pull settings
  const remoteSettings = await storage.pullSettings();
  if (remoteSettings) {
    const settingsDoc = await db.settings.findOne('settings').exec();
    const current = settingsDoc ? settingsDoc.toJSON() : defaultSettings;
    await db.settings.upsert({
      ...current,
      id: 'settings',
      newCardsPerDay: remoteSettings.newCardsPerDay,
      reviewOrder: remoteSettings.reviewOrder,
      theme: remoteSettings.theme,
    });
  }
}

export async function cancelSync(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  dirtyCardIds.clear();
  dirtyReviewLogIds.clear();
}

