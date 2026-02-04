import { useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { AuthScreen } from './AuthScreen';
import { DeckListScreen } from './DeckListScreen';
import { ReviewScreen } from './ReviewScreen';
import { SyncScreen } from './SyncScreen';
import { SettingsScreen } from './SettingsScreen';
import { useState } from 'react';

type Screen =
  | { name: 'auth' }
  | { name: 'deck-list' }
  | { name: 'review'; deck: string }
  | { name: 'sync' }
  | { name: 'settings' };

export function App() {
  const { settings, isConfigured, isLoading } = useSettings();
  const [screen, setScreen] = useState<Screen>({ name: 'auth' });

  // Set initial screen based on config
  useEffect(() => {
    if (!isLoading) {
      setScreen(isConfigured ? { name: 'deck-list' } : { name: 'auth' });
    }
  }, [isLoading, isConfigured]);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (settings.theme === 'system') {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      }
    }
  }, [settings.theme]);

  const navigate = (s: Screen) => setScreen(s);

  if (isLoading) {
    return <div className="min-h-dvh flex items-center justify-center">Loading...</div>;
  }

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
