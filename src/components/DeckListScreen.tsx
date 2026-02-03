import { useState, useEffect } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import {
  cardsCollection,
  cardStatesCollection,
  getPendingCount,
} from '../services/collections';
import { isNew, isDue } from '../utils/fsrs';

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
  const [pendingCount, setPendingCount] = useState(0);

  // Get all cards
  const { data: cards, isLoading: cardsLoading } = useLiveQuery((q) =>
    q.from({ cards: cardsCollection }).select(({ cards }) => ({
      id: cards.id,
      deckName: cards.deckName,
      reversible: cards.reversible,
    })),
  );

  // Get all card states
  const { data: states, isLoading: statesLoading } = useLiveQuery((q) =>
    q.from({ states: cardStatesCollection }).select(({ states }) => ({
      id: states.id,
      deckName: states.deckName,
      cardId: states.cardId,
      state: states.state,
    })),
  );

  useEffect(() => {
    const updatePending = async () => {
      const count = await getPendingCount();
      setPendingCount(count);
    };
    updatePending();

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loading = cardsLoading || statesLoading;

  // Compute deck info
  const decks: DeckInfo[] = [];
  console.log('DeckList cards:', cards?.length, cards);
  console.log('DeckList states:', states?.length, states);
  if (cards && cards.length > 0) {
    const deckNames = new Set(cards.map((c) => c.deckName));
    const stateMap = new Map((states || []).map((s) => [s.id, s.state]));
    console.log('DeckList deckNames:', [...deckNames]);
    console.log('DeckList stateMap keys:', [...stateMap.keys()]);

    for (const name of deckNames) {
      const deckCards = cards.filter((c) => c.deckName === name);
      console.log(`DeckList ${name} deckCards:`, deckCards.length, deckCards);
      let dueCount = 0;
      let newCount = 0;

      for (const card of deckCards) {
        const cardId = card.id.split('/')[1];
        console.log(`DeckList checking card: ${card.id} -> cardId: ${cardId}`);

        // Check forward card
        const stateKey = `${name}/${cardId}`;
        const forwardState = stateMap.get(stateKey);
        console.log(`DeckList forwardState for ${stateKey}:`, forwardState);
        if (!forwardState || isNew(forwardState)) {
          newCount++;
          console.log(`DeckList ${cardId}: counted as new (newCount=${newCount})`);
        } else if (isDue(forwardState)) {
          dueCount++;
          console.log(`DeckList ${cardId}: counted as due (dueCount=${dueCount})`);
        }

        // Check reverse card if reversible
        if (card.reversible) {
          const reverseKey = `${name}/${cardId}:reverse`;
          const reverseState = stateMap.get(reverseKey);
          console.log(`DeckList reverseState for ${reverseKey}:`, reverseState);
          if (!reverseState || isNew(reverseState)) {
            newCount++;
            console.log(`DeckList ${cardId}:reverse: counted as new (newCount=${newCount})`);
          } else if (isDue(reverseState)) {
            dueCount++;
            console.log(`DeckList ${cardId}:reverse: counted as due (dueCount=${dueCount})`);
          }
        }
      }

      console.log(`DeckList pushing deck: ${name} with due=${dueCount}, new=${newCount}`);
      decks.push({ name, dueCount, newCount });
    }
  }

  if (loading || (cards && cards.length === 0)) {
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
