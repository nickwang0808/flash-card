import { useRxQuery } from './useRxQuery';
import { getDatabaseSync, type SettingsDoc } from '../services/rxdb';

interface Settings {
  id: string;
  repoUrl: string;
  token: string;
  newCardsPerDay: number;
  reviewOrder: 'random' | 'oldest-first' | 'deck-grouped';
  theme: 'light' | 'dark' | 'system';
  branch?: string;
  apiBaseUrl?: string;
}

export const defaultSettings: Settings = {
  id: 'settings',
  repoUrl: '',
  token: '',
  newCardsPerDay: 10,
  reviewOrder: 'random',
  theme: 'system',
};

export function useSettings() {
  const db = getDatabaseSync();
  const { data, isLoading } = useRxQuery(db.settings);

  const settings: Settings = data.length > 0
    ? { ...defaultSettings, ...data[0] } as Settings
    : defaultSettings;
  const isConfigured = settings.repoUrl.length > 0 && settings.token.length > 0;

  function update(partial: Partial<Omit<Settings, 'id'>>) {
    const updated = { ...settings, ...partial } as SettingsDoc;
    return db.settings.upsert(updated);
  }

  async function clear() {
    const doc = await db.settings.findOne('settings').exec();
    if (doc) await doc.remove();
    window.location.reload();
  }

  return { settings, isLoading, isConfigured, update, clear };
}
