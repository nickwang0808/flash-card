import { Redirect, useLocalSearchParams } from 'expo-router';

import { StudyScreen } from '@/screens/StudyScreen';

export default function StudyRoute() {
  const { deckId } = useLocalSearchParams<{ deckId?: string | string[] }>();
  if (typeof deckId !== 'string' || !deckId) return <Redirect href="/decks" />;
  return <StudyScreen deckId={deckId} />;
}
