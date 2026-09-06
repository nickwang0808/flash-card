import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { ScreenState } from '@/components/feedback/ScreenState';
import { SignInScreen } from '@/screens/SignInScreen';

export default function SignInRoute() {
  const { session, isRestoring } = useAuth();
  if (isRestoring) return <ScreenState loading title="Restoring session" />;
  if (session) return <Redirect href="/decks" />;
  return <SignInScreen />;
}
