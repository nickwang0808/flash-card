import { useCallback } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useRxQuery } from '@/hooks/useRxQuery';
import { getDatabaseSync } from '@/services/rxdb';

const SWIPE_THRESHOLD = 100;

export default function ApproveScreen() {
  const { deck } = useLocalSearchParams<{ deck: string }>();
  const router = useRouter();
  const db = getDatabaseSync();
  const { width: screenWidth } = useWindowDimensions();

  const { data: pendingCards, isLoading } = useRxQuery(db.cards, {
    selector: { deckName: deck, approved: false, suspended: false },
    sort: [{ order: 'asc' }],
  });

  const currentCard = pendingCards[0] ?? null;

  const translateX = useSharedValue(0);
  const isAnimating = useSharedValue(false);

  const approve = useCallback(async (cardId: string) => {
    const doc = await db.cards.findOne(cardId).exec();
    if (doc) await doc.incrementalPatch({ approved: true });
  }, [db]);

  const reject = useCallback(async (cardId: string) => {
    const doc = await db.cards.findOne(cardId).exec();
    if (doc) await doc.incrementalPatch({ suspended: true });
  }, [db]);

  const handleSwipeComplete = useCallback(
    (direction: 'left' | 'right') => {
      if (!currentCard) return;
      if (direction === 'right') {
        approve(currentCard.id);
      } else {
        reject(currentCard.id);
      }
    },
    [currentCard, approve, reject],
  );

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onUpdate((e) => {
      if (isAnimating.value) return;
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (isAnimating.value) return;

      if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
        const direction = e.translationX > 0 ? 'right' : 'left';
        const target = direction === 'right' ? screenWidth : -screenWidth;
        isAnimating.value = true;
        translateX.value = withTiming(target, { duration: 250 }, () => {
          runOnJS(handleSwipeComplete)(direction);
          translateX.value = 0;
          isAnimating.value = false;
        });
      } else {
        translateX.value = withSpring(0);
      }
    });

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      {
        rotate: `${interpolate(
          translateX.value,
          [-screenWidth, 0, screenWidth],
          [-15, 0, 15],
          Extrapolation.CLAMP,
        )}deg`,
      },
    ],
  }));

  const approveOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, SWIPE_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const rejectOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_THRESHOLD, 0],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  if (!currentCard) {
    return (
      <View className="flex-1 items-center justify-center p-4 gap-4">
        <Text className="text-xl font-bold text-foreground">All Done</Text>
        <Text className="text-muted-foreground">No more cards to review.</Text>
        <Pressable
          role="button"
          onPress={() => router.back()}
          className="rounded-md bg-primary px-4 py-2"
        >
          <Text className="text-sm font-medium text-primary-foreground">Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 p-4 max-w-md mx-auto w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <Pressable role="button" onPress={() => router.back()}>
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>
        <Text className="text-sm text-muted-foreground">
          {pendingCards.length} remaining
        </Text>
      </View>

      {/* Swipeable card */}
      <View className="flex-1 items-center justify-center">
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={cardAnimatedStyle}
            className="w-full rounded-xl border border-border p-6 bg-card"
            testID="swipe-card"
          >
            {/* Approve overlay */}
            <Animated.View
              style={approveOverlayStyle}
              className="absolute top-4 left-4 rounded-md border-2 border-green-500 px-3 py-1"
            >
              <Text className="text-green-500 font-bold text-lg">APPROVE</Text>
            </Animated.View>

            {/* Reject overlay */}
            <Animated.View
              style={rejectOverlayStyle}
              className="absolute top-4 right-4 rounded-md border-2 border-red-500 px-3 py-1"
            >
              <Text className="text-red-500 font-bold text-lg">REJECT</Text>
            </Animated.View>

            {/* Card content */}
            <View className="items-center gap-4 mt-8">
              <View>
                <Text className="text-xs text-muted-foreground mb-1">Term</Text>
                <Text className="text-xl font-bold text-foreground text-center">
                  {currentCard.term}
                </Text>
              </View>

              {currentCard.front && (
                <View>
                  <Text className="text-xs text-muted-foreground mb-1">Front</Text>
                  <Text className="text-foreground text-center">
                    {currentCard.front}
                  </Text>
                </View>
              )}

              <View>
                <Text className="text-xs text-muted-foreground mb-1">Back</Text>
                <Text className="text-foreground text-center">
                  {currentCard.back}
                </Text>
              </View>

              {currentCard.tags && (() => {
                const parsed: string[] = (() => { try { return JSON.parse(currentCard.tags); } catch { return []; } })();
                return parsed.length > 0 ? (
                  <View className="flex-row gap-1">
                    {parsed.map((tag: string) => (
                      <View key={tag} className="rounded-full bg-muted px-2 py-0.5">
                        <Text className="text-xs text-muted-foreground">{tag}</Text>
                      </View>
                    ))}
                  </View>
                ) : null;
              })()}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      {/* Hint */}
      <View className="items-center py-4">
        <Text className="text-xs text-muted-foreground">
          Swipe right to approve · Swipe left to reject
        </Text>
      </View>
    </View>
  );
}
