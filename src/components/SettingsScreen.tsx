import { useAuth } from '../hooks/useAuth';
import { useRxQuery } from '../hooks/useRxQuery';
import { getDatabaseSync, destroyDatabase, type SettingsDoc } from '../services/rxdb';
import { supabase } from '../services/supabase';

interface Props {
  onBack: () => void;
  onLogout: () => void;
}

export function SettingsScreen({ onBack }: Props) {
  const db = getDatabaseSync();
  const { data: settingsList } = useRxQuery(db.settings);
  const s = settingsList[0];
  const { signOut } = useAuth();

  async function update(partial: Partial<SettingsDoc>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await db.settings.upsert({
      id: 'settings',
      userId: user.id,
      newCardsPerDay: partial.newCardsPerDay ?? s?.newCardsPerDay ?? 10,
      reviewOrder: partial.reviewOrder ?? s?.reviewOrder ?? 'random',
      theme: partial.theme ?? s?.theme ?? 'system',
    });
  }

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
        {/* Account */}
        <div>
          <label className="block text-sm font-medium mb-1">Account</label>
          <p className="text-sm text-muted-foreground">
            Signed in via GitHub
          </p>
        </div>

        {/* New cards per day */}
        <div>
          <label className="block text-sm font-medium mb-1">New cards per day</label>
          <input
            type="number"
            min={0}
            value={s?.newCardsPerDay ?? 10}
            onChange={(e) => {
              const val = Math.floor(Number(e.target.value));
              if (val >= 0) update({ newCardsPerDay: val });
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        {/* Review order */}
        <div>
          <label className="block text-sm font-medium mb-1">Review order</label>
          <select
            value={s?.reviewOrder ?? 'random'}
            onChange={(e) => update({ reviewOrder: e.target.value })}
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
                  (s?.theme ?? 'system') === t
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
