import { useState, useEffect } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { decksCollection } from '../services/collections';
import { useDeck } from '../hooks/useDeck';

interface Props {
  onSelectDeck: (deck: string) => void;
  onSync: () => void;
  onSettings: () => void;
}

// DeckRow component that uses useDeck for counts
function DeckRow({
  deckName,
  onSelect,
}: {
  deckName: string;
  onSelect: () => void;
}) {
  const { newItems, dueItems } = useDeck(deckName);

  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-lg border border-border p-4 hover:bg-accent transition-colors"
    >
      <div className="font-medium">{deckName}</div>
      <div className="text-sm text-muted-foreground mt-1">
        <span className="text-blue-500">{dueItems.length} due</span>
        {' · '}
        <span className="text-green-500">{newItems.length} new</span>
      </div>
    </button>
  );
}

export function DeckListScreen({ onSelectDeck, onSync, onSettings }: Props) {
  const [online, setOnline] = useState(navigator.onLine);

  // Get deck names from decks collection
  const { data: decks, isLoading } = useLiveQuery(
    (q) => q.from({ decks: decksCollection }),
    [],
  );

  const deckNames = decks?.map((deck) => deck.name) ?? [];

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-muted-foreground">Loading decks...</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh p-4 max-w-md mx-auto">
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
      </div>

      <div className="space-y-3">
        {deckNames.map((deckName) => (
          <DeckRow
            key={deckName}
            deckName={deckName}
            onSelect={() => onSelectDeck(deckName)}
          />
        ))}

        {deckNames.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No decks found. Add directories with cards.json to your repo.
          </p>
        )}
      </div>
    </div>
  );
}
