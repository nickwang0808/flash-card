export interface Settings {
  repoUrl: string;
  token: string;
  newCardsPerDay: number;
  reviewOrder: 'random' | 'oldest-first' | 'deck-grouped';
  theme: 'light' | 'dark' | 'system';
  branch?: string; // Optional branch for testing isolation
}

const STORAGE_KEY = 'flash-card-settings';

const defaults: Settings = {
  repoUrl: '',
  token: '',
  newCardsPerDay: 10,
  reviewOrder: 'random',
  theme: 'system',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

function save(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const settingsStore = {
  get(): Settings {
    return load();
  },

  set(partial: Partial<Settings>): void {
    const current = load();
    save({ ...current, ...partial });
  },

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },

  isConfigured(): boolean {
    const s = load();
    return s.repoUrl.length > 0 && s.token.length > 0;
  },
};
