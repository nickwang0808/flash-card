import { View } from 'react-native';

import { readFrontendEnvironment } from '@/api/environment';
import { useAuth } from '@/auth/AuthProvider';
import { GitHubSignInButton, SignInForm } from '@/components/auth/SignInForm';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

interface SignInScreenProps {
  returnTo: string;
}

function redirectUrl(siteUrl: string, returnTo: string): string {
  const base = new URL(siteUrl);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(returnTo.replace(/^\/+/, ''), base).href;
}

export function SignInScreen({ returnTo }: SignInScreenProps) {
  const { authMode, siteUrl } = readFrontendEnvironment();
  const { signInWithPassword, signInWithGitHub } = useAuth();
  return <View className="flex-1 items-center justify-center bg-background px-5">
    <Card className="w-full max-w-md gap-6 p-6">
      <View className="gap-2"><Heading size="2xl">Flash Cards</Heading><Text className="text-muted-foreground">Sign in to study your decks.</Text></View>
      {authMode === 'password'
        ? <SignInForm onSubmit={signInWithPassword} />
        : <GitHubSignInButton onSubmit={() => signInWithGitHub(redirectUrl(siteUrl, returnTo))} />}
    </Card>
  </View>;
}
