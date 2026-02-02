import { useState, useEffect } from 'react';
import { settingsStore } from '../services/settings-store';
import { AuthScreen } from './AuthScreen';
import { DeckListScreen } from './DeckListScreen';
import { ReviewScreen } from './ReviewScreen';
import { SyncScreen } from './SyncScreen';
import { SettingsScreen } from './SettingsScreen';

type Screen =
  | { name: 'auth' }
  | { name: 'deck-list' }
  | { name: 'review'; deck: string }
  | { name: 'sync' }
  | { name: 'settings' };

export function App() {
  const [screen, setScreen] = useState<Screen>(
    settingsStore.isConfigured() ? { name: 'deck-list' } : { name: 'auth' },
  );

  useEffect(() => {
    const settings = settingsStore.get();
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.matches) document.documentElement.classList.add('dark');
    }
  }, []);

  const navigate = (s: Screen) => setScreen(s);

  switch (screen.name) {
    case 'auth':
      return <AuthScreen onComplete={() => navigate({ name: 'deck-list' })} />;
    case 'deck-list':
      return (
        <DeckListScreen
          onSelectDeck={(deck) => navigate({ name: 'review', deck })}
          onSync={() => navigate({ name: 'sync' })}
          onSettings={() => navigate({ name: 'settings' })}
        />
      );
    case 'review':
      return (
        <ReviewScreen
          deck={screen.deck}
          onBack={() => navigate({ name: 'deck-list' })}
        />
      );
    case 'sync':
      return <SyncScreen onBack={() => navigate({ name: 'deck-list' })} />;
    case 'settings':
      return (
        <SettingsScreen
          onBack={() => navigate({ name: 'deck-list' })}
          onLogout={() => navigate({ name: 'auth' })}
        />
      );
  }
}
