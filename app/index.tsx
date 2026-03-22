import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';

export default function Index() {
  const { isSignedIn, loading } = useAuth();

  if (loading) return null;

  return <Redirect href={isSignedIn ? '/decks' : '/auth'} />;
}
