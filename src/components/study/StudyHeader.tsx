import { View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

interface StudyHeaderProps {
  canUndo: boolean;
  remaining: number;
  onEnd(): void;
  onUndo(): void;
}

export function StudyHeader({ canUndo, remaining, onEnd, onUndo }: StudyHeaderProps) {
  return <View className="flex-row items-center justify-between gap-3"><Button size="sm" variant="outline" onPress={onEnd}><ButtonText>End session</ButtonText></Button><View className="items-center gap-1"><Text className="text-lg font-semibold text-foreground">{remaining} remaining</Text>{canUndo ? <Button size="sm" variant="link" onPress={onUndo} testID="undo-review"><ButtonText>Undo</ButtonText></Button> : null}</View></View>;
}
