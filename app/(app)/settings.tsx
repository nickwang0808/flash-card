import { View, Text, Pressable, TextInput, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useAuth } from '@/hooks/useAuth';
import { useRxQuery } from '@/hooks/useRxQuery';
import { getDatabaseSync, destroyDatabase, type SettingsDoc } from '@/services/rxdb';

export default function SettingsScreen() {
  const router = useRouter();
  const db = getDatabaseSync();
  const { data: settingsList } = useRxQuery(db.settings);
  const s = settingsList[0];
  const { signOut } = useAuth();

  async function update(partial: Partial<SettingsDoc>) {
    if (!s) return;
    await db.settings.upsert({ ...s, ...partial });
  }

  if (!s) {
    return (
      <View className="flex-1 items-center justify-center p-4">
        <Text className="text-sm text-muted-foreground">Loading settings...</Text>
      </View>
    );
  }

  async function handleLogout() {
    if (Platform.OS === 'web') {
      if (!confirm('Clear all local data and log out?')) return;
      try { await signOut(); } catch (_) {}
      try { await destroyDatabase(); } catch (_) {}
      window.location.reload();
    } else {
      Alert.alert('Logout', 'Clear all local data and log out?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try { await signOut(); } catch (_) {}
            try { await destroyDatabase(); } catch (_) {}
            router.replace('/auth');
          },
        },
      ]);
    }
  }

  const themes = ['light', 'dark', 'system'] as const;

  return (
    <View className="flex-1 p-4 max-w-md mx-auto w-full">
      <View className="flex-row items-center justify-between mb-6">
        <Pressable role="button" onPress={() => router.back()}>
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>
        <Text className="text-xl font-bold text-foreground">Settings</Text>
        <View className="w-10" />
      </View>

      <View className="gap-6">
        {/* Account */}
        <View>
          <Text className="text-sm font-medium text-foreground mb-1">Account</Text>
          <Text className="text-sm text-muted-foreground">Signed in via GitHub</Text>
        </View>

        {/* New cards per day */}
        <View>
          <Text className="text-sm font-medium text-foreground mb-1">New cards per day</Text>
          <TextInput
            keyboardType="numeric"
            defaultValue={String(s?.newCardsPerDay ?? 10)}
            key={s?.newCardsPerDay}
            onBlur={(e) => {
              const val = Math.floor(Number(e.nativeEvent.text));
              if (val >= 0 && !isNaN(val)) update({ newCardsPerDay: val });
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </View>

        {/* Review order — web uses native select, native would use a custom picker */}
        {Platform.OS === 'web' && (
          <View>
            <Text className="text-sm font-medium text-foreground mb-1">Review order</Text>
            <select
              value={s?.reviewOrder ?? 'random'}
              onChange={(e: any) => update({ reviewOrder: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="random">Random</option>
              <option value="oldest-first">Oldest first</option>
              <option value="deck-grouped">Deck grouped</option>
            </select>
          </View>
        )}

        {/* Theme */}
        <View>
          <Text className="text-sm font-medium text-foreground mb-1">Theme</Text>
          <View className="flex-row gap-2">
            {themes.map((t) => (
              <Pressable
                role="button"
                key={t}
                onPress={() => update({ theme: t })}
                className={`flex-1 rounded-md border px-3 py-2 items-center ${
                  (s?.theme ?? 'system') === t
                    ? 'border-primary bg-primary/10'
                    : 'border-input'
                }`}
              >
                <Text className="text-sm text-foreground capitalize">{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Logout */}
        <View className="pt-4 border-t border-border">
          <Pressable
            role="button"
            onPress={handleLogout}
            className="w-full rounded-md bg-destructive px-4 py-2 items-center"
          >
            <Text className="text-sm font-medium text-destructive-foreground">Logout</Text>
          </Pressable>
          <Text className="text-xs text-muted-foreground mt-2 text-center">
            Clears all local data
          </Text>
        </View>

        {/* Version */}
        <View className="pt-4 border-t border-border items-center">
          <Text className="text-xs text-muted-foreground font-mono">
            {Constants.expoConfig?.extra?.commitHash}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {Constants.expoConfig?.extra?.commitMessage}
          </Text>
        </View>
      </View>
    </View>
  );
}
