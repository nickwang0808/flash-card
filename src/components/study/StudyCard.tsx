import { ScrollView, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import type { QueueItem } from '@/features/study/useStudySession';
import { visibleSpeechSide } from '@/features/speech/speechPlacement';

import { StudyStatusBadge } from './StudyStatusBadge';

interface StudyCardProps {
  card: QueueItem;
  answerRevealed: boolean;
  canSpeak: boolean;
  speechIsPlaying: boolean;
  onReveal(): void;
  onSpeak(): void;
}

function PronunciationButton({ isPlaying, onPress }: { isPlaying: boolean; onPress(): void }) {
  return <Button accessibilityLabel="Play pronunciation" onPress={onPress} size="sm" testID="play-pronunciation" variant="ghost"><ButtonText>{isPlaying ? 'Playing pronunciation' : 'Play pronunciation'}</ButtonText></Button>;
}

export function StudyCard({ card, answerRevealed, canSpeak, speechIsPlaying, onReveal, onSpeak }: StudyCardProps) {
  const speechSide = visibleSpeechSide(card, canSpeak);
  const showFrontPronunciation = speechSide === 'front';
  const showBackPronunciation = speechSide === 'back';
  return <Card className="min-h-80 flex-1 gap-5 p-6"><View className="flex-row items-center justify-between gap-3"><StudyStatusBadge status={card.status} /><Text className="flex-1 text-right text-sm text-muted-foreground">{card.name}</Text></View><ScrollView contentContainerClassName="flex-grow justify-center"><View className="items-center gap-2" testID="card-front"><Heading className="text-center text-3xl">{card.frontMarkdown}</Heading>{showFrontPronunciation ? <PronunciationButton isPlaying={speechIsPlaying} onPress={onSpeak} /> : null}</View>{answerRevealed ? <View className="mt-8 items-center gap-2 border-t border-border pt-6" testID="card-back"><Text className="text-center text-xl text-foreground">{card.backMarkdown}</Text>{showBackPronunciation ? <PronunciationButton isPlaying={speechIsPlaying} onPress={onSpeak} /> : null}</View> : null}</ScrollView>{answerRevealed ? null : <Button onPress={onReveal} testID="show-answer"><ButtonText>Show answer</ButtonText></Button>}</Card>;
}
