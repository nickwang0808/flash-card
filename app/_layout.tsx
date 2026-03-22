import { useEffect, useRef, useState } from 'react';
import { Platform, View, Text } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useRxQuery } from '@/hooks/useRxQuery';
import { getDatabase, getDatabaseSync, type AppDatabase } from '@/services/rxdb';
import { supabase } from '@/services/supabase';
import { startReplication, cancelReplication, type ReplicationStates } from '@/services/supabase-replication';

import '../src/styles/global.css';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    getDatabase().then((db) => {
      if (__DEV__ && Platform.OS === 'web') {
        (window as any).__RXDB__ = db;
        (window as any).__SUPABASE__ = supabase;
      }
      setDbReady(true);
    });
  }, []);

  if (!dbReady) return null;

  return <AuthGatedLayout />;
}

function AuthGatedLayout() {
  const { isSignedIn, loading: authLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const replicationRef = useRef<ReplicationStates | null>(null);
  const [syncReady, setSyncReady] = useState(false);

  const db = getDatabaseSync();
  const { data: settingsList } = useRxQuery(db.settings);
  const theme = settingsList[0]?.theme ?? 'system';

  // Apply theme (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.documentElement.classList.remove('dark');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (theme === 'system') {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      }
    }
  }, [theme]);

  // Auth redirect
  useEffect(() => {
    if (authLoading) return;
    const inAuth = segments[0] === 'auth';

    if (!isSignedIn && !inAuth) {
      router.replace('/auth');
    } else if (isSignedIn && inAuth) {
      router.replace('/decks');
    }
  }, [isSignedIn, authLoading, segments, router]);

  // Start/stop replication — block UI until initial pull completes
  useEffect(() => {
    if (!isSignedIn) {
      setSyncReady(false);
      if (replicationRef.current) {
        cancelReplication(replicationRef.current);
        replicationRef.current = null;
      }
      return;
    }

    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      const db = getDatabaseSync();
      const { states, initialSyncDone } = startReplication(db, supabase, user.id);
      replicationRef.current = states;

      initialSyncDone.then(() => {
        if (!cancelled) setSyncReady(true);
      });
    });

    return () => {
      cancelled = true;
      if (replicationRef.current) {
        cancelReplication(replicationRef.current);
        replicationRef.current = null;
      }
    };
  }, [isSignedIn]);

  if (authLoading) return null;

  if (isSignedIn && !syncReady) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground">Syncing...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Slot />
    </View>
  );
}
