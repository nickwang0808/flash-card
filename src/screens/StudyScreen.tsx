import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, ScrollView, View } from 'react-native';

import { ScreenState } from '@/components/feedback/ScreenState';
import { Button, ButtonText } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { RatingBar } from '@/components/study/RatingBar';
import { StudyCard } from '@/components/study/StudyCard';
import { StudyHeader } from '@/components/study/StudyHeader';
import { useDecksQuery } from '@/features/decks/useDecksQuery';
import { useStudySession } from '@/features/study/useStudySession';

interface StudyScreenProps {
  deckId: string;
}

export function StudyScreen({ deckId }: StudyScreenProps) {
  const study = useStudySession(deckId);
  const decks = useDecksQuery();
  const deckName = decks.data?.decks.find((deck) => deck.id === deckId)?.name ?? 'Study';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && study.pendingRatings === 0) void study.refetch();
    });
    return () => subscription.remove();
  }, [study]);

  if (study.phase === 'loading') return <ScreenState loading title="Loading study queue" />;
  if (study.phase === 'error') return <ScreenState title="Could not load study queue" detail={study.error?.message} actionLabel="Retry" onAction={() => void study.refetch()} />;
  if (study.phase === 'saving') return <ScreenState loading title="Saving reviews…" detail="Waiting for the server-issued queue." testID="saving-reviews" />;
  if (study.phase === 'complete') return <ScreenState title="Session complete" detail="There are no more cards in this queue." actionLabel="Back to decks" onAction={() => router.replace('/decks')} />;
  if (!study.activeCard) return null;

  return <ScrollView className="flex-1 bg-background" contentContainerClassName="mx-auto min-h-full w-full max-w-md gap-5 p-5">
    <View className="gap-1"><Text className="text-sm text-muted-foreground">{deckName}</Text><StudyHeader canUndo={study.canUndo} onEnd={() => router.replace('/decks')} onUndo={study.undo} remaining={study.remaining} /></View>
    {study.error ? <View accessibilityRole="alert" className="gap-2 rounded-md bg-destructive/10 p-3"><Text className="text-destructive">{study.error.message}</Text><Button size="sm" variant="outline" onPress={() => void study.refetch()}><ButtonText>Retry</ButtonText></Button></View> : null}
    <StudyCard answerRevealed={study.answerRevealed} card={study.activeCard} onReveal={study.reveal} />
    {study.answerRevealed ? <RatingBar disabled={false} onRate={study.rate} /> : null}
  </ScrollView>;
}
