import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { ScreenState } from '@/components/feedback/ScreenState';
import { SignInScreen } from '@/screens/SignInScreen';

function internalReturnTo(value: string | string[] | undefined): string {
  const path = typeof value === 'string' ? value : null;
  return path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/decks';
}

export default function SignInRoute() {
  const { session, isRestoring } = useAuth();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const destination = internalReturnTo(returnTo);
  if (isRestoring) return <ScreenState loading title="Restoring session" />;
  if (session) return <Redirect href={destination as Href} />;
  return <SignInScreen returnTo={destination} />;
}
