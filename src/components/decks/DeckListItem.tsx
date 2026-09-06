import { Pressable, View } from 'react-native';

import type { Deck } from '@/domain/Deck';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

interface DeckListItemProps {
  deck: Deck;
  onPress(): void;
}

export function DeckListItem({ deck, onPress }: DeckListItemProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Study ${deck.name}`} onPress={onPress} testID={`deck-${deck.id}`}>
    <Card className="gap-1 p-5"><Heading size="lg">{deck.name}</Heading><Text className="text-muted-foreground">Study this deck</Text></Card>
  </Pressable>;
}
