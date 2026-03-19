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

// --- Immediate push (fire-and-forget) ---

export function notifyChange(cardId: string): void {
  if (!navigator.onLine) return;

  const storage = getStorage();
  const repo = getCardRepository();
  repo.getCardDataByIds([cardId]).then((cards) => {
    if (cards.length > 0) storage.pushCards(cards);
  }).catch(() => {});
}

export function notifyReviewLogChange(logId: string): void {
  if (!navigator.onLine) return;

  const storage = getStorage();
  const db = getDatabaseSync();
  db.reviewlogs.findOne(logId).exec().then((doc) => {
    if (doc) storage.pushReviewLogs([doc.toJSON() as unknown as StoredReviewLog]);
  }).catch(() => {});
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

// --- Full sync (pull from Supabase → replace local) ---

let syncInProgress: Promise<void> | null = null;

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
  // No-op — pushes are immediate now, nothing to cancel
}

// flushSync kept for API compatibility (tab-hide handler in App.tsx)
// but is a no-op since pushes are immediate
export function flushSync(): void {}
