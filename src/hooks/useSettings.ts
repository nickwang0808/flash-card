import { useRxQuery } from './useRxQuery';
import { getDatabaseSync, type SettingsDoc } from '../services/rxdb';
import { notifySettingsChange } from '../services/replication';

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

export function useSettings() {
  const db = getDatabaseSync();
  const { data, isLoading } = useRxQuery(db.settings);

  const settings: Settings = data.length > 0
    ? { ...defaultSettings, ...data[0] } as Settings
    : defaultSettings;

  async function update(partial: Partial<Omit<Settings, 'id'>>) {
    const updated = { ...settings, ...partial, id: 'settings' } as SettingsDoc;
    await db.settings.upsert(updated);
    notifySettingsChange().catch(() => {});
  }

  async function clear() {
    const doc = await db.settings.findOne('settings').exec();
    if (doc) await doc.remove();
    window.location.reload();
  }

  return { settings, isLoading, update, clear };
}
