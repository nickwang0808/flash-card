import { useState, useEffect } from 'react';
import {
  cardsCollection,
  cardStatesCollection,
} from '../services/collections';
import { isNew, isDue, type CardState } from '../utils/fsrs';

interface Props {
  onSelectDeck: (deck: string) => void;
  onSync: () => void;
  onSettings: () => void;
}

interface DeckInfo {
  name: string;
  dueCount: number;
  newCount: number;
}

export function DeckListScreen({ onSelectDeck, onSync, onSettings }: Props) {
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [decks, setDecks] = useState<DeckInfo[]>([]);

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

  useEffect(() => {
    async function loadDecks() {
      setLoading(true);

      // Wait for collections to be ready
      const cards = await cardsCollection.toArrayWhenReady();
      const states = await cardStatesCollection.toArrayWhenReady();

      // Build state map
      const stateMap = new Map<string, CardState>();
      for (const row of states) {
        stateMap.set(row.id, row.state);
      }

      // Compute deck info
      const deckMap = new Map<string, DeckInfo>();

      for (const card of cards) {
        const deckName = card.deckName;
        const cardId = card.id.split('/')[1];

        if (!deckMap.has(deckName)) {
          deckMap.set(deckName, { name: deckName, dueCount: 0, newCount: 0 });
        }
        const deck = deckMap.get(deckName)!;

        // Check forward card
        const forwardState = stateMap.get(`${deckName}/${cardId}`);
        if (!forwardState || isNew(forwardState)) {
          deck.newCount++;
        } else if (isDue(forwardState)) {
          deck.dueCount++;
        }

        // Check reverse card if reversible
        if (card.reversible) {
          const reverseState = stateMap.get(`${deckName}/${cardId}:reverse`);
          if (!reverseState || isNew(reverseState)) {
            deck.newCount++;
          } else if (isDue(reverseState)) {
            deck.dueCount++;
          }
        }
      }

      setDecks(Array.from(deckMap.values()));
      setLoading(false);
    }

    loadDecks();
  }, []);

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
      </div>

      <div className="space-y-3">
        {decks.map((deck) => (
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

        {decks.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No decks found. Add directories with cards.json to your repo.
          </p>
        )}
      </div>
    </div>
  );
}
