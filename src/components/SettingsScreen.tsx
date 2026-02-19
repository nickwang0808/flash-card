import { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useAuth } from '../hooks/useAuth';
import { destroyDatabase } from '../services/rxdb';

interface Props {
  onBack: () => void;
  onLogout: () => void;
}

export function SettingsScreen({ onBack }: Props) {
  const { settings, update } = useSettings();
  const { signOut } = useAuth();
  const [editingRepo, setEditingRepo] = useState(false);
  const [repoUrl, setRepoUrl] = useState(settings.repoUrl);

  async function handleLogout() {
    if (!confirm('Clear all local data and log out?')) return;
    try {
      await signOut();
    } catch (_) { /* best-effort */ }
    try {
      await destroyDatabase();
    } catch (_) { /* best-effort */ }
    window.location.reload();
  }

  return (
    <div className="h-dvh overflow-y-auto p-4 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          Back
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
        <div className="w-10" />
      </div>

      <div className="space-y-6">
        {/* Repository URL */}
        <div>
          <label className="block text-sm font-medium mb-1">Repository</label>
          {editingRepo ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="owner/repo"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={() => {
                  update({ repoUrl });
                  setEditingRepo(false);
                }}
                className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setRepoUrl(settings.repoUrl);
                  setEditingRepo(false);
                }}
                className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground break-all">
                {settings.repoUrl || 'Not configured'}
              </p>
              <button
                onClick={() => setEditingRepo(true)}
                className="text-sm text-primary hover:underline ml-2"
              >
                Edit
              </button>
            </div>
          )}
        </div>

        {/* GitHub Auth */}
        <div>
          <label className="block text-sm font-medium mb-1">GitHub</label>
          <p className="text-sm text-muted-foreground">
            Connected via GitHub OAuth
          </p>
        </div>

        {/* New cards per day */}
        <div>
          <label className="block text-sm font-medium mb-1">New cards per day</label>
          <input
            type="number"
            min={1}
            value={settings.newCardsPerDay}
            onChange={(e) => {
              const val = Math.floor(Number(e.target.value));
              if (val >= 1) update({ newCardsPerDay: val });
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        {/* Review order */}
        <div>
          <label className="block text-sm font-medium mb-1">Review order</label>
          <select
            value={settings.reviewOrder}
            onChange={(e) => update({ reviewOrder: e.target.value as typeof settings.reviewOrder })}
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

        {/* Version */}
        <div className="pt-4 border-t border-border text-center">
          <p className="text-xs text-muted-foreground font-mono">
            {__COMMIT_HASH__}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {__COMMIT_MESSAGE__}
          </p>
        </div>
      </div>
    </div>
  );
}
