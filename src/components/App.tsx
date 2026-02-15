import { useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { runSync, flushSync } from '../services/replication';
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
  const [screen, setScreen] = useState<Screen>(() =>
    // Can't check isConfigured here (initial render), will fix in effect below
    ({ name: 'auth' })
  );

  // Set initial screen once settings load
  useEffect(() => {
    if (isLoading) return;
    if (isConfigured) {
      setScreen({ name: 'deck-list' });
    } else {
      setScreen({ name: 'auth' });
    }
  // Only run when loading completes, not on every isConfigured change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Initial sync — once after bootstrap
  useEffect(() => {
    runSync().catch(() => {});
  }, []);

  // Tab hide — flush pending debounced pushes immediately
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushSync();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

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
    return <div className="h-dvh flex items-center justify-center">Loading...</div>;
  }

  function handleAuthComplete() {
    navigate({ name: 'deck-list' });
    runSync().catch(() => {});
  }

  switch (screen.name) {
    case 'auth':
      return <AuthScreen onComplete={handleAuthComplete} />;
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
