import { useState, useEffect } from 'react';
import { cardStore } from '../services/card-store';
import { syncManager } from '../services/sync-manager';

interface Props {
  onSelectDeck: (deck: string) => void;
  onSync: () => void;
  onSettings: () => void;
}

export function DeckListScreen({ onSelectDeck, onSync, onSettings }: Props) {
  const [decks, setDecks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    loadDecks();
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function loadDecks() {
    setLoading(true);
    try {
      await cardStore.loadAllDecks();
      setDecks(cardStore.getDeckNames());
      const status = await syncManager.getStatus();
      setSyncStatus(status);
    } catch (e: any) {
      console.error('Failed to load decks:', e);
    }
    setLoading(false);
  }

  async function handleSync() {
    setSyncStatus('syncing...');
    const result = await syncManager.sync();
    if (result.status === 'ok') {
      await loadDecks();
    } else if (result.status === 'conflict') {
      setSyncStatus(`conflict — pushed to ${result.branch}`);
    } else {
      setSyncStatus(`error: ${result.message}`);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading decks...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Decks</h1>
        <div className="flex gap-2">
          <button
            onClick={onSync}
            className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
          >
            Sync
          </button>
          <button
            onClick={onSettings}
            className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
          >
            Settings
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
        <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
        <span>{online ? 'Online' : 'Offline'}</span>
        {syncStatus && <span>· {syncStatus}</span>}
      </div>

      <div className="space-y-3">
        {decks.map((deck) => {
          const dueCount = cardStore.getDueCount(deck);
          const newCount = cardStore.getNewCount(deck);
          return (
            <button
              key={deck}
              onClick={() => onSelectDeck(deck)}
              className="w-full text-left rounded-lg border border-border p-4 hover:bg-accent transition-colors"
            >
              <div className="font-medium">{deck}</div>
              <div className="text-sm text-muted-foreground mt-1">
                <span className="text-blue-500">{dueCount} due</span>
                {' · '}
                <span className="text-green-500">{newCount} new</span>
              </div>
            </button>
          );
        })}

        {decks.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No decks found. Add directories with cards.json to your repo.
          </p>
        )}
      </div>

      <div className="mt-6 text-center">
        <button
          onClick={handleSync}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          Sync Now
        </button>
      </div>
    </div>
  );
}
