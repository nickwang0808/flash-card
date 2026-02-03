import { useState, useEffect } from 'react';
import { syncManager } from '../services/sync-manager';
import { useDecks } from '../hooks/use-decks';

interface Props {
  onSelectDeck: (deck: string) => void;
  onSync: () => void;
  onSettings: () => void;
}

export function DeckListScreen({ onSelectDeck, onSync, onSettings }: Props) {
  const { data: decks, isLoading: loading, refetch } = useDecks();
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    setSyncStatus(syncManager.getStatus());
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function handleSync() {
    setSyncStatus('syncing...');
    const result = await syncManager.sync();
    if (result.status === 'ok') {
      await refetch();
      setSyncStatus('synced');
    } else {
      setSyncStatus(`error: ${result.message}`);
    }
  }

  const pendingCount = syncManager.getPendingCount();

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
        {pendingCount > 0 && <span>· {pendingCount} pending</span>}
        {syncStatus && <span>· {syncStatus}</span>}
      </div>

      <div className="space-y-3">
        {decks?.map((deck) => (
          <button
            key={deck.name}
            onClick={() => onSelectDeck(deck.name)}
            className="w-full text-left rounded-lg border border-border p-4 hover:bg-accent transition-colors"
          >
            <div className="font-medium">{deck.name}</div>
            <div className="text-sm text-muted-foreground mt-1">
              <span className="text-blue-500">{deck.dueCount} due</span>
              {' · '}
              <span className="text-green-500">{deck.newCount} new</span>
            </div>
          </button>
        ))}

        {(!decks || decks.length === 0) && (
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
