import '../global.css';

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from '@expo-google-fonts/inter/useFonts';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/auth/AuthProvider';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  if (fontError) throw fontError;
  if (!fontsLoaded) return null;

  return <GluestackUIProvider mode="system"><SafeAreaProvider><AuthProvider><Stack screenOptions={{ headerShown: false }} /></AuthProvider></SafeAreaProvider></GluestackUIProvider>;
}
