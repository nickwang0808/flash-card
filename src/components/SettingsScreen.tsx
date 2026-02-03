import { useState } from 'react';
import { settingsStore, type Settings } from '../services/settings-store';
import { queryClient } from '../services/query-client';

interface Props {
  onBack: () => void;
  onLogout: () => void;
}

export function SettingsScreen({ onBack, onLogout }: Props) {
  const [settings, setSettings] = useState<Settings>(settingsStore.get());

  function update(partial: Partial<Settings>) {
    settingsStore.set(partial);
    setSettings(settingsStore.get());

    // Apply theme immediately
    if (partial.theme) {
      document.documentElement.classList.remove('dark');
      if (partial.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (partial.theme === 'system') {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.classList.add('dark');
        }
      }
    }
  }

  function handleLogout() {
    if (!confirm('Clear all local data and log out?')) return;
    settingsStore.clear();
    localStorage.removeItem('flash-card-pending-reviews');
    localStorage.removeItem('flash-card-new-count');
    localStorage.removeItem('flash-card-last-sync');
    queryClient.clear();
    onLogout();
  }

  return (
    <div className="min-h-screen p-4 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          Back
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
        <div className="w-10" />
      </div>

      <div className="space-y-6">
        {/* Repo URL (read-only) */}
        <div>
          <label className="block text-sm font-medium mb-1">Repository</label>
          <p className="text-sm text-muted-foreground break-all">
            {settings.repoUrl || 'Not configured'}
          </p>
        </div>

        {/* New cards per day */}
        <div>
          <label className="block text-sm font-medium mb-1">
            New cards per day: {settings.newCardsPerDay}
          </label>
          <input
            type="range"
            min={0}
            max={50}
            value={settings.newCardsPerDay}
            onChange={(e) => update({ newCardsPerDay: Number(e.target.value) })}
            className="w-full"
          />
        </div>

        {/* Review order */}
        <div>
          <label className="block text-sm font-medium mb-1">Review order</label>
          <select
            value={settings.reviewOrder}
            onChange={(e) => update({ reviewOrder: e.target.value as Settings['reviewOrder'] })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="random">Random</option>
            <option value="oldest-first">Oldest first</option>
            <option value="deck-grouped">Deck grouped</option>
          </select>
        </div>

        {/* Theme */}
        <div>
          <label className="block text-sm font-medium mb-1">Theme</label>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => update({ theme: t })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize ${
                  settings.theme === t
                    ? 'border-primary bg-primary/10'
                    : 'border-input hover:bg-accent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Logout */}
        <div className="pt-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full rounded-md bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium hover:bg-destructive/90"
          >
            Logout
          </button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Clears all local data
          </p>
        </div>
      </div>
    </div>
  );
}
