import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';

interface SnackbarProps {
  message: string | null;
  onDismiss: () => void;
  duration?: number;
}

export function Snackbar({ message, onDismiss, duration = 5000 }: SnackbarProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, onDismiss, duration]);

  if (!message) return null;

  return (
    <View className="absolute bottom-6 left-4 right-4 z-50">
      <View className="bg-destructive rounded-lg px-4 py-3 flex-row items-center justify-between shadow-lg">
        <Text className="text-destructive-foreground text-sm flex-1 mr-3">{message}</Text>
        <Pressable role="button" onPress={onDismiss} hitSlop={8}>
          <Text className="text-destructive-foreground text-sm font-bold">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
