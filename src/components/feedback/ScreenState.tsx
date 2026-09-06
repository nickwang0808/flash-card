import { View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';

interface ScreenStateProps {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  loading?: boolean;
}

export function ScreenState({ title, detail, actionLabel, onAction, testID, loading }: ScreenStateProps) {
  return <View className="flex-1 items-center justify-center gap-4 bg-background px-6" testID={testID}>
    {loading ? <Spinner size="large" className="text-primary" /> : null}
    <Text className="text-center text-xl font-semibold text-foreground">{title}</Text>
    {detail ? <Text className="max-w-md text-center text-muted-foreground">{detail}</Text> : null}
    {actionLabel && onAction ? <Button onPress={onAction}><ButtonText>{actionLabel}</ButtonText></Button> : null}
  </View>;
}
