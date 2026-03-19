import { useRxQuery } from './useRxQuery';
import { getDatabaseSync, type SettingsDoc } from '../services/rxdb';

interface Settings {
  id: string;
  newCardsPerDay: number;
  reviewOrder: 'random' | 'oldest-first' | 'deck-grouped';
  theme: 'light' | 'dark' | 'system';
}

export const defaultSettings: Settings = {
  id: 'settings',
  newCardsPerDay: 10,
  reviewOrder: 'random',
  theme: 'system',
};

function docToSettings(doc: Record<string, any>): Settings {
  return {
    id: doc.id,
    newCardsPerDay: doc.new_cards_per_day ?? defaultSettings.newCardsPerDay,
    reviewOrder: (doc.review_order ?? defaultSettings.reviewOrder) as Settings['reviewOrder'],
    theme: (doc.theme ?? defaultSettings.theme) as Settings['theme'],
  };
}

export function useSettings() {
  const db = getDatabaseSync();
  const { data, isLoading } = useRxQuery(db.settings);

  const settings: Settings = data.length > 0
    ? docToSettings(data[0])
    : defaultSettings;

  async function update(partial: Partial<Omit<Settings, 'id'>>) {
    // Read existing doc to get user_id
    const existing = await db.settings.findOne('settings').exec();
    const userId = existing?.user_id ?? '';

    const updated: SettingsDoc = {
      id: 'settings',
      user_id: userId,
      new_cards_per_day: partial.newCardsPerDay ?? settings.newCardsPerDay,
      review_order: partial.reviewOrder ?? settings.reviewOrder,
      theme: partial.theme ?? settings.theme,
    };
    await db.settings.upsert(updated);
    // Replication auto-pushes to Supabase
  }

  async function clear() {
    const doc = await db.settings.findOne('settings').exec();
    if (doc) await doc.remove();
    window.location.reload();
  }

  return { settings, isLoading, update, clear };
}
