import { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { Rating, type Grade } from 'ts-fsrs';
import { useDeck } from '@/hooks/useDeck';
import { useRxQuery } from '@/hooks/useRxQuery';
import { getDatabaseSync } from '@/services/rxdb';
import { useTts } from '@/hooks/useTts';
import { TtsLocalePicker } from '@/components/TtsLocalePicker';

function useForegroundColor(): string {
  const db = getDatabaseSync();
  const { data: settingsList } = useRxQuery(db.settings);
  const theme = settingsList[0]?.theme ?? 'system';

  return useMemo(() => {
    if (Platform.OS !== 'web') return '#000';
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    // Read from CSS variables (matches global.css)
    return isDark ? 'hsl(210, 40%, 98%)' : 'hsl(222.2, 84%, 4.9%)';
  }, [theme]);
}

const ratingConfig = [
  { rating: Rating.Again, label: 'Again', color: 'bg-red-500/10', textColor: 'text-red-500', borderColor: 'border-red-500/20' },
  { rating: Rating.Hard, label: 'Hard', color: 'bg-orange-500/10', textColor: 'text-orange-500', borderColor: 'border-orange-500/20' },
  { rating: Rating.Good, label: 'Good', color: 'bg-green-500/10', textColor: 'text-green-500', borderColor: 'border-green-500/20' },
  { rating: Rating.Easy, label: 'Easy', color: 'bg-blue-500/10', textColor: 'text-blue-500', borderColor: 'border-blue-500/20' },
];

export default function ReviewScreen() {
  const { deck } = useLocalSearchParams<{ deck: string }>();
  const router = useRouter();
  const { currentCard, remaining, rate, superEasy, schedulePreview, suspend, undo, canUndo, isLoading } = useDeck(deck!);
  const { speak, showPicker, selectLocale, dismissPicker, voices } = useTts(deck!);
  const foregroundColor = useForegroundColor();
  const markdownStyles = useMemo(() => ({
    body: { fontSize: 28, color: foregroundColor },
    em: { fontStyle: 'italic' as const },
    strong: { fontWeight: 'bold' as const },
    blockquote: { borderLeftWidth: 3, borderLeftColor: '#888', paddingLeft: 12 },
  }), [foregroundColor]);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [cardKey, setCardKey] = useState(0);

  function handleRate(rating: Grade) {
    rate(rating);
    setAnswerRevealed(false);
    setCardKey(k => k + 1);
  }

  function handleSuperEasy() {
    superEasy();
    setAnswerRevealed(false);
    setCardKey(k => k + 1);
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted-foreground">Loading cards...</Text>
      </View>
    );
  }

  if (!currentCard) {
    return (
      <View className="flex-1 items-center justify-center p-4 gap-4">
        <Text className="text-xl font-bold text-foreground">Session Complete</Text>
        <Text className="text-muted-foreground">No more cards to review today.</Text>
        <Pressable
          role="button"
          onPress={() => router.back()}
          className="rounded-md bg-primary px-4 py-2"
        >
          <Text className="text-sm font-medium text-primary-foreground">Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 p-4 max-w-md mx-auto w-full">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-4">
        <Pressable role="button" onPress={() => router.back()}>
          <Text className="text-sm text-muted-foreground">End Session</Text>
        </Pressable>
        <View className="flex-row items-center gap-3">
          {canUndo && (
            <Pressable role="button" onPress={undo}>
              <Text className="text-sm text-muted-foreground">Undo</Text>
            </Pressable>
          )}
          <Pressable
            role="button"
            onPress={() => { suspend(); setAnswerRevealed(false); setCardKey(k => k + 1); }}
          >
            <Text className="text-sm text-muted-foreground">Suspend</Text>
          </Pressable>
          <Text className="text-sm text-muted-foreground">{remaining} remaining</Text>
        </View>
      </View>

      {/* Card */}
      <ScrollView
        key={cardKey}
        className="flex-1"
        contentContainerClassName="items-center justify-center flex-grow gap-6"
      >
        {currentCard.isNew && (
          <Text className="text-xs font-medium text-green-500 uppercase tracking-wider">
            New
          </Text>
        )}

        <View className="items-center" testID="card-front">
          <Markdown style={markdownStyles}>{currentCard.front}</Markdown>
          {currentCard.isReverse && (
            <Text className="text-xs text-muted-foreground mt-1">reverse</Text>
          )}
          {!currentCard.isReverse && (
            <Pressable
              role="button"
              onPress={() => speak(currentCard.term)}
              className="mt-2"
              testID="tts-button"
            >
              <Text className="text-muted-foreground text-lg">🔊</Text>
            </Pressable>
          )}
        </View>

        {answerRevealed ? (
          <View className="items-center gap-3" testID="card-back">
            <Markdown style={markdownStyles}>{currentCard.back}</Markdown>
            {currentCard.isReverse && (
              <Pressable
                role="button"
                onPress={() => speak(currentCard.term)}
                className="mt-2"
                testID="tts-button"
              >
                <Text className="text-muted-foreground text-lg">🔊</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <Pressable
            role="button"
            onPress={() => setAnswerRevealed(true)}
            className="rounded-md border border-input px-6 py-3"
          >
            <Text className="text-sm font-medium text-foreground">Show Answer</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Rating buttons */}
      {answerRevealed && (
        <View className="gap-2 pt-4 pb-4">
          <View className="flex-row gap-2">
            {ratingConfig.map(({ rating, label, color, textColor, borderColor }) => (
              <Pressable
                key={rating}
                role="button"
                onPress={() => handleRate(rating)}
                className={`flex-1 rounded-md ${color} border ${borderColor} px-2 py-3 items-center`}
              >
                <Text className={`text-sm font-medium ${textColor}`}>{label}</Text>
                <Text className={`text-xs ${textColor} opacity-70`}>
                  {schedulePreview?.[rating]}
                </Text>
              </Pressable>
            ))}
          </View>
          {currentCard.isNew && (
            <Pressable
              role="button"
              onPress={handleSuperEasy}
              className="rounded-md bg-violet-500/10 border border-violet-500/20 px-2 py-3 items-center"
              testID="super-easy-button"
            >
              <Text className="text-sm font-medium text-violet-500">Already Know · 60d</Text>
            </Pressable>
          )}
        </View>
      )}

      {showPicker && (
        <TtsLocalePicker
          voices={voices}
          onSelect={selectLocale}
          onDismiss={dismissPicker}
        />
      )}
    </View>
  );
}
