import { useState, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useCards, type FlashCard } from '@/hooks/useDeck';
import { getDatabaseSync } from '@/services/rxdb';

const SWIPE_THRESHOLD = 80;

function SwipeableCardRow({
  card,
  onPress,
}: {
  card: FlashCard;
  onPress: () => void;
}) {
  const translateX = useSharedValue(0);
  const rowHeight = useSharedValue<number | undefined>(undefined);
  const isAnimating = useSharedValue(false);
  const isPending = !card.approved;

  const handleAction = useCallback(
    async (direction: 'left' | 'right') => {
      const db = getDatabaseSync();
      const doc = await db.cards.findOne(card.id).exec();
      if (!doc) return;
      if (direction === 'right') {
        await doc.incrementalPatch({ approved: true });
      } else {
        await doc.incrementalPatch({ suspended: true });
      }
      translateX.value = 0;
      isAnimating.value = false;
    },
    [card.id, translateX, isAnimating],
  );

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-10, 10])
    .enabled(isPending)
    .onUpdate((e) => {
      if (isAnimating.value) return;
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (isAnimating.value) return;
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
        const direction = e.translationX > 0 ? 'right' : 'left';
        const target = direction === 'right' ? 400 : -400;
        isAnimating.value = true;
        translateX.value = withTiming(target, { duration: 200 }, () => {
          runOnJS(handleAction)(direction);
        });
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const approveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));

  const rejectStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));

  const isSuspended = card.suspended;

  return (
    <View className="relative overflow-hidden rounded-lg">
      {/* Background actions */}
      {isPending && (
        <>
          <Animated.View
            style={approveStyle}
            className="absolute inset-0 bg-green-500/20 items-start justify-center pl-4 rounded-lg"
          >
            <Text className="text-green-500 font-bold">APPROVE</Text>
          </Animated.View>
          <Animated.View
            style={rejectStyle}
            className="absolute inset-0 bg-red-500/20 items-end justify-center pr-4 rounded-lg"
          >
            <Text className="text-red-500 font-bold">REJECT</Text>
          </Animated.View>
        </>
      )}

      {/* Swipeable row */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={animatedStyle}>
          <Pressable
            role="button"
            onPress={onPress}
            className={`rounded-lg border border-border p-3 bg-background ${isSuspended ? 'opacity-40' : ''}`}
            testID="card-row"
          >
            <Text className="font-medium text-foreground">{card.term}</Text>
            <Text className="text-sm text-muted-foreground mt-0.5" numberOfLines={1}>
              {card.back}
            </Text>
            <View className="flex-row gap-2 mt-1">
              {card.tags && card.tags.length > 0 && (
                <Text className="text-xs text-muted-foreground">
                  {card.tags.join(', ')}
                </Text>
              )}
              {card.reversible && (
                <Text className="text-xs text-blue-500">reversible</Text>
              )}
              {isSuspended && (
                <Text className="text-xs text-red-500">suspended</Text>
              )}
              {isPending && (
                <Text className="text-xs text-orange-500">pending</Text>
              )}
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function CardListScreen() {
  const { deck } = useLocalSearchParams<{ deck: string }>();
  const router = useRouter();
  const { data: cards, isLoading } = useCards(deck!);
  const [search, setSearch] = useState('');

  const pendingCount = useMemo(
    () => cards.filter((c) => !c.approved && !c.suspended).length,
    [cards],
  );

  const filtered = useMemo(() => {
    let result = cards.filter((c) => !c.suspended);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.term.toLowerCase().includes(q) ||
          (c.front && c.front.toLowerCase().includes(q)) ||
          c.back.toLowerCase().includes(q),
      );
    }
    return result;
  }, [cards, search]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted-foreground">Loading cards...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 p-4 max-w-md mx-auto w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-4">
        <Pressable role="button" onPress={() => router.back()}>
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>
        <Text className="text-lg font-bold text-foreground">{deck}</Text>
        {pendingCount > 0 && (
          <Pressable
            role="button"
            onPress={() => router.push(`/cards/approve/${deck}`)}
            className="rounded-md bg-orange-500/10 border border-orange-500/20 px-3 py-1.5"
          >
            <Text className="text-sm font-medium text-orange-500">
              Approve {pendingCount}
            </Text>
          </Pressable>
        )}
        {pendingCount === 0 && <View />}
      </View>

      {/* Search */}
      <TextInput
        className="rounded-md border border-input px-3 py-2 text-sm text-foreground mb-4"
        placeholder="Search cards..."
        placeholderTextColor="#888"
        value={search}
        onChangeText={setSearch}
        testID="card-search"
      />

      {/* Card list */}
      <ScrollView className="flex-1">
        <View className="gap-2">
          {filtered.map((card) => (
            <SwipeableCardRow
              key={card.id}
              card={card}
              onPress={() => router.push(`/cards/edit/${card.id}`)}
            />
          ))}
          {filtered.length === 0 && (
            <Text className="text-center text-muted-foreground py-8">
              {search ? 'No cards match your search.' : 'No cards in this deck.'}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
