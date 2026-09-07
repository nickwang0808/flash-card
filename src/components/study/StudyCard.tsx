import { ScrollView, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { Button } from '@/components/ui/button';
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
  onSpeak(): void;
}

function PronunciationButton({ isPlaying, onPress }: { isPlaying: boolean; onPress(): void }) {
  return <Button accessibilityLabel={isPlaying ? 'Playing pronunciation' : 'Play pronunciation'} onPress={onPress} size="icon" testID="play-pronunciation" variant="ghost"><Svg aria-hidden className="text-foreground" height={20} viewBox="0 0 24 24" width={20}><Path d="M11 5 6 9H2v6h4l5 4V5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /><Path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={2} /><Path d="M19 5a10 10 0 0 1 0 14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={2} /></Svg></Button>;
}

export function StudyCard({ card, answerRevealed, canSpeak, speechIsPlaying, onSpeak }: StudyCardProps) {
  const speechSide = visibleSpeechSide(card, canSpeak);
  const showFrontPronunciation = speechSide === 'front';
  const showBackPronunciation = speechSide === 'back';
  return <Card className="min-h-80 flex-1 gap-5 p-6"><StudyStatusBadge status={card.status} /><ScrollView contentContainerClassName="flex-grow justify-center"><View className="items-center gap-2" testID="card-front"><Heading className="text-center text-3xl">{card.frontMarkdown}</Heading>{showFrontPronunciation ? <PronunciationButton isPlaying={speechIsPlaying} onPress={onSpeak} /> : null}</View>{answerRevealed ? <View className="mt-8 items-center gap-2 border-t border-border pt-6" testID="card-back"><Text className="text-center text-xl text-foreground">{card.backMarkdown}</Text>{showBackPronunciation ? <PronunciationButton isPlaying={speechIsPlaying} onPress={onSpeak} /> : null}</View> : null}</ScrollView></Card>;
}
