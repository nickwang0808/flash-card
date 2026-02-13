import { useEffect, useCallback } from 'react';
import { useSettings } from '../hooks/useSettings';
import { runSync } from '../services/replication';
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

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function App() {
  const { settings, isConfigured, isLoading } = useSettings();
  const [screen, setScreen] = useState<Screen>({ name: 'auth' });

  const triggerSync = useCallback(() => {
    if (!isConfigured || !navigator.onLine) return;
    runSync().catch(() => {
      // Sync errors are non-fatal — data is safe locally
    });
  }, [isConfigured]);

  // Set initial screen based on config
  useEffect(() => {
    if (!isLoading) {
      if (isConfigured) {
        setScreen({ name: 'deck-list' });
        // Sync on app load if configured
        triggerSync();
      } else {
        setScreen({ name: 'auth' });
      }
    }
  }, [isLoading, isConfigured, triggerSync]);

  // Periodic sync + sync on tab focus
  useEffect(() => {
    if (!isConfigured) return;

    const interval = setInterval(triggerSync, SYNC_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerSync();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isConfigured, triggerSync]);

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
    // Navigate to deck-list; the isConfigured useEffect will trigger sync
    navigate({ name: 'deck-list' });
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
