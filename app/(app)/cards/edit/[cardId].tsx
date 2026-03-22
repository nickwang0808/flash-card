import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getDatabaseSync, type CardDoc } from '@/services/rxdb';

export default function CardEditScreen() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const router = useRouter();
  const [card, setCard] = useState<CardDoc | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Form state
  const [term, setTerm] = useState('');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState('');
  const [reversible, setReversible] = useState(false);
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    const db = getDatabaseSync();
    const sub = db.cards.findOne(cardId).$.subscribe((doc) => {
      if (!doc) {
        setIsLoading(false);
        return;
      }
      const data = doc.toJSON() as CardDoc;
      setCard(data);
      setTerm(data.term);
      setFront(data.front ?? '');
      setBack(data.back);
      setTags(data.tags ? JSON.parse(data.tags).join(', ') : '');
      setReversible(data.reversible);
      setSuspended(data.suspended);
      setIsLoading(false);
    });
    return () => sub.unsubscribe();
  }, [cardId]);

  async function handleSave() {
    const db = getDatabaseSync();
    const doc = await db.cards.findOne(cardId).exec();
    if (!doc) return;

    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await doc.incrementalPatch({
      term,
      front: front || undefined,
      back,
      tags: parsedTags.length > 0 ? JSON.stringify(parsedTags) : undefined,
      reversible,
      suspended,
    });

    router.back();
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted-foreground">Loading card...</Text>
      </View>
    );
  }

  if (!card) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted-foreground">Card not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 p-4 max-w-md mx-auto w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <Pressable role="button" onPress={() => router.back()}>
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>
        <Pressable
          role="button"
          onPress={handleSave}
          className="rounded-md bg-primary px-4 py-1.5"
          testID="save-button"
        >
          <Text className="text-sm font-medium text-primary-foreground">Save</Text>
        </Pressable>
      </View>

      {/* Form */}
      <View className="gap-4">
        <View>
          <Text className="text-sm font-medium text-foreground mb-1">Term</Text>
          <TextInput
            className="rounded-md border border-input px-3 py-2 text-sm text-foreground"
            value={term}
            onChangeText={setTerm}
            testID="edit-term"
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-foreground mb-1">Front (optional)</Text>
          <TextInput
            className="rounded-md border border-input px-3 py-2 text-sm text-foreground"
            value={front}
            onChangeText={setFront}
            placeholder={term}
            placeholderTextColor="#888"
            testID="edit-front"
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-foreground mb-1">Back</Text>
          <TextInput
            className="rounded-md border border-input px-3 py-2 text-sm text-foreground"
            value={back}
            onChangeText={setBack}
            multiline
            numberOfLines={3}
            testID="edit-back"
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-foreground mb-1">Tags (comma-separated)</Text>
          <TextInput
            className="rounded-md border border-input px-3 py-2 text-sm text-foreground"
            value={tags}
            onChangeText={setTags}
            placeholder="vocab, verbs, ..."
            placeholderTextColor="#888"
            testID="edit-tags"
          />
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-medium text-foreground">Reversible</Text>
          <Switch value={reversible} onValueChange={setReversible} testID="edit-reversible" />
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-medium text-foreground">Suspended</Text>
          <Switch value={suspended} onValueChange={setSuspended} testID="edit-suspended" />
        </View>

        {/* Approval status (read-only) */}
        <View className="flex-row items-center gap-2 pt-2 border-t border-border">
          <Text className="text-sm text-muted-foreground">Status:</Text>
          <Text className={`text-sm font-medium ${card.approved ? 'text-green-500' : 'text-orange-500'}`}>
            {card.approved ? 'Approved' : 'Pending approval'}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
