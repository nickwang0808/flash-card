import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { ScreenState } from '@/components/feedback/ScreenState';

export default function Index() {
  const { session, isRestoring } = useAuth();
  if (isRestoring) return <ScreenState loading title="Restoring session" />;
  return <Redirect href={session ? '/decks' : '/sign-in'} />;
}
