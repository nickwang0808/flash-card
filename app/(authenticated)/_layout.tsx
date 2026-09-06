import { Redirect, Stack } from 'expo-router';

import { ApiProvider } from '@/api/ApiProvider';
import { useAuth } from '@/auth/AuthProvider';
import { ScreenState } from '@/components/feedback/ScreenState';
import { QueryProvider } from '@/query/QueryProvider';

export default function AuthenticatedLayout() {
  const { session, isRestoring } = useAuth();
  if (isRestoring) return <ScreenState loading title="Restoring session" />;
  if (!session) return <Redirect href="/sign-in" />;
  return <ApiProvider key={session.user.id}><QueryProvider key={session.user.id}><Stack screenOptions={{ headerShown: false }} /></QueryProvider></ApiProvider>;
}
