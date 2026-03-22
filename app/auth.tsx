import { View, Text, Pressable } from 'react-native';
import { useAuth } from '@/hooks/useAuth';

export default function AuthScreen() {
  const { signInWithGitHub, devSignIn } = useAuth();

  return (
    <View className="flex-1 items-center justify-center p-4">
      <View className="w-full max-w-md gap-6">
        <View className="items-center">
          <Text className="text-2xl font-bold text-foreground">Flash Cards</Text>
          <Text className="text-sm text-muted-foreground mt-1">
            Spaced repetition with cloud sync
          </Text>
        </View>

        <View className="gap-4">
          <Pressable
            role="button"
            onPress={signInWithGitHub}
            className="w-full rounded-md bg-primary px-4 py-2 items-center"
          >
            <Text className="text-sm font-medium text-primary-foreground">
              Sign in with GitHub
            </Text>
          </Pressable>
          {__DEV__ && (
            <Pressable
              role="button"
              onPress={devSignIn}
              className="w-full rounded-md border border-input px-4 py-2 items-center"
            >
              <Text className="text-sm font-medium text-foreground">
                Dev Login (local only)
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
