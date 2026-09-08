import { View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
const countFormatter = new Intl.NumberFormat();

interface StudyHeaderProps {
  canUndo: boolean;
  reviewCount: number;
  newCount: number;
  onEnd(): void;
  onUndo(): void;
}

export function StudyHeader({ canUndo, reviewCount, newCount, onEnd, onUndo }: StudyHeaderProps) {
  return <View className="flex-row items-center gap-2"><Button size="sm" variant="outline" onPress={onEnd}><ButtonText>End session</ButtonText></Button><Text className="flex-1 text-center text-sm font-semibold text-foreground">{countFormatter.format(reviewCount)} review · {countFormatter.format(newCount)} new</Text><View className="w-14 items-end">{canUndo ? <Button size="sm" variant="link" onPress={onUndo} testID="undo-review"><ButtonText>Undo</ButtonText></Button> : null}</View></View>;
}
