import { View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { SignInForm } from '@/components/auth/SignInForm';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

export function SignInScreen() {
  const { signIn } = useAuth();
  return <View className="flex-1 items-center justify-center bg-background px-5">
    <Card className="w-full max-w-md gap-6 p-6">
      <View className="gap-2"><Heading size="2xl">Flash Cards</Heading><Text className="text-muted-foreground">Sign in to study your decks.</Text></View>
      <SignInForm onSubmit={signIn} />
    </Card>
  </View>;
}
