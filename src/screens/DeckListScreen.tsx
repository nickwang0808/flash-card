import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { DeckListItem } from '@/components/decks/DeckListItem';
import { ScreenState } from '@/components/feedback/ScreenState';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { useDecksQuery } from '@/features/decks/useDecksQuery';

export function DeckListScreen() {
  const { signOut } = useAuth();
  const decks = useDecksQuery();

  if (decks.isPending) return <ScreenState loading title="Loading decks" />;
  if (decks.isError) return <ScreenState title="Could not load decks" detail={decks.error.message} actionLabel="Retry" onAction={() => void decks.refetch()} />;

  return <ScrollView className="flex-1 bg-background" contentContainerClassName="mx-auto w-full max-w-md gap-4 p-5">
    <View className="mb-4 flex-row items-start justify-between gap-4"><View className="flex-1 gap-1"><Heading size="2xl">Your decks</Heading><Text className="text-muted-foreground">Choose a deck to begin studying.</Text></View><Button variant="outline" size="sm" onPress={() => void signOut()}><ButtonText>Sign out</ButtonText></Button></View>
    {decks.data.decks.length ? decks.data.decks.map((deck) => <DeckListItem deck={deck} key={deck.id} onPress={() => router.push(`/study/${deck.id}`)} />) : <ScreenState title="No decks yet" detail="Create a deck through the API, then return here to study it." />}
  </ScrollView>;
}
