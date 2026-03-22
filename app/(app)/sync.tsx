import { useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

export default function SyncScreen() {
  const router = useRouter();
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <View className="flex-1 p-4 max-w-md mx-auto w-full">
      <View className="flex-row items-center justify-between mb-6">
        <Pressable role="button" onPress={() => router.back()}>
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>
        <Text className="text-xl font-bold text-foreground">Sync</Text>
        <View className="w-10" />
      </View>

      <View className="gap-3 mb-6">
        <View className="flex-row items-center gap-2">
          <View className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
          <Text className="text-sm text-foreground">{online ? 'Online' : 'Offline'}</Text>
        </View>
        <Text className="text-xs text-muted-foreground">
          Changes sync automatically when online. Reviews are always saved locally first.
        </Text>
      </View>
    </View>
  );
}
