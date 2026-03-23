import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useDeck, useDeckNames } from '@/hooks/useDeck';

function DeckRow({ deckName }: { deckName: string }) {
  const { newItems, dueItems } = useDeck(deckName);
  const router = useRouter();

  return (
    <Pressable
      role="button"
      onPress={() => router.push(`/review/${deckName}`)}
      onLongPress={() => router.push(`/cards/${deckName}`)}
      className="w-full rounded-lg border border-border p-4"
    >
      <Text className="font-medium text-foreground">{deckName}</Text>
      <View className="flex-row mt-1">
        <Text className="text-sm text-blue-500">{dueItems.length} due</Text>
        <Text className="text-sm text-muted-foreground"> · </Text>
        <Text className="text-sm text-green-500">{newItems.length} new</Text>
      </View>
    </Pressable>
  );
}

export default function DeckListScreen() {
  const router = useRouter();
  const { data: deckNames, isLoading } = useDeckNames();
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
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
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted-foreground">Loading decks...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 p-4 max-w-md mx-auto w-full">
      <View className="flex-row items-center justify-between mb-6">
        <Text className="text-xl font-bold text-foreground">Decks</Text>
        <View className="flex-row gap-2">
          <Pressable
            role="button"
            onPress={() => router.push('/translator')}
            className="rounded-md border border-input px-3 py-1.5"
          >
            <Text className="text-sm text-foreground">Translate</Text>
          </Pressable>
          <Pressable
            role="button"
            onPress={() => router.push('/sync')}
            className="rounded-md border border-input px-3 py-1.5"
          >
            <Text className="text-sm text-foreground">Sync</Text>
          </Pressable>
          <Pressable
            role="button"
            onPress={() => router.push('/settings')}
            className="rounded-md border border-input px-3 py-1.5"
          >
            <Text className="text-sm text-foreground">Settings</Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row items-center gap-2 mb-4">
        <View className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
        <Text className="text-xs text-muted-foreground">{online ? 'Online' : 'Offline'}</Text>
      </View>

      <View className="gap-3">
        {deckNames.map((name) => (
          <DeckRow key={name} deckName={name} />
        ))}
        {deckNames.length === 0 && (
          <Text className="text-center text-muted-foreground py-8">
            No decks found. Sync to pull your cards.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
