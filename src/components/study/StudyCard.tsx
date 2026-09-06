import { ScrollView, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import type { QueueItem } from '@/features/study/useStudySession';

import { StudyStatusBadge } from './StudyStatusBadge';

interface StudyCardProps {
  card: QueueItem;
  answerRevealed: boolean;
  onReveal(): void;
}

export function StudyCard({ card, answerRevealed, onReveal }: StudyCardProps) {
  return <Card className="min-h-80 flex-1 gap-5 p-6"><View className="flex-row items-center justify-between gap-3"><StudyStatusBadge status={card.status} /><Text className="flex-1 text-right text-sm text-muted-foreground">{card.name}</Text></View><ScrollView contentContainerClassName="flex-grow justify-center"><View testID="card-front"><Heading className="text-center text-3xl">{card.frontMarkdown}</Heading></View>{answerRevealed ? <View className="mt-8 border-t border-border pt-6" testID="card-back"><Text className="text-center text-xl text-foreground">{card.backMarkdown}</Text></View> : null}</ScrollView>{answerRevealed ? null : <Button onPress={onReveal} testID="show-answer"><ButtonText>Show answer</ButtonText></Button>}</Card>;
}
