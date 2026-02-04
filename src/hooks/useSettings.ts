import { useLiveQuery } from '@tanstack/react-db';
import { createCollection, localStorageCollectionOptions } from '@tanstack/db';

export interface Settings {
  id: string;
  repoUrl: string;
  token: string;
  newCardsPerDay: number;
  reviewOrder: 'random' | 'oldest-first' | 'deck-grouped';
  theme: 'light' | 'dark' | 'system';
  branch?: string;
}

export const defaultSettings: Settings = {
  id: 'settings',
  repoUrl: '',
  token: '',
  newCardsPerDay: 10,
  reviewOrder: 'random',
  theme: 'system',
};

export const settingsCollection = createCollection<Settings, string>(
  localStorageCollectionOptions({
    storageKey: 'flash-card-settings',
    getKey: (item) => item.id,
  }),
);

export function useSettings() {
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ settings: settingsCollection }),
    [],
  );

  const settings = data?.[0] ?? defaultSettings;
  const isConfigured = settings.repoUrl.length > 0 && settings.token.length > 0;

  function update(partial: Partial<Omit<Settings, 'id'>>) {
    const updated = { ...settings, ...partial };
    if (settingsCollection.state.has('settings')) {
      settingsCollection.update('settings', (draft) => {
        Object.assign(draft, partial);
      });
    } else {
      settingsCollection.insert(updated);
    }
  }

  function clear() {
    settingsCollection.utils.clearStorage();
    window.location.reload();
  }

  return { settings, isLoading, isConfigured, update, clear };
}
