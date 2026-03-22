import { useState, useEffect, useCallback, useRef } from 'react';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';

function storageKey(deckName: string): string {
  return `tts-locale:${deckName}`;
}

export interface TtsVoice {
  identifier: string;
  name: string;
  language: string;
}

function useAvailableVoices(): TtsVoice[] {
  const [voices, setVoices] = useState<TtsVoice[]>([]);

  useEffect(() => {
    Speech.getAvailableVoicesAsync().then(setVoices);
  }, []);

  return voices;
}

export function useTts(deckName: string) {
  const [locale, setLocale] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const pendingText = useRef<string | null>(null);
  const voices = useAvailableVoices();

  // Load locale from storage
  useEffect(() => {
    AsyncStorage.getItem(storageKey(deckName)).then((val) => {
      setLocale(val);
    });
  }, [deckName]);

  const speakWithLocale = useCallback((text: string, lang: string) => {
    Speech.stop();
    Speech.speak(text, { language: lang });
  }, []);

  const speak = useCallback((text: string) => {
    if (locale) {
      speakWithLocale(text, locale);
    } else {
      pendingText.current = text;
      setShowPicker(true);
    }
  }, [locale, speakWithLocale]);

  const selectLocale = useCallback((lang: string) => {
    AsyncStorage.setItem(storageKey(deckName), lang);
    setLocale(lang);
    setShowPicker(false);
    if (pendingText.current) {
      speakWithLocale(pendingText.current, lang);
      pendingText.current = null;
    }
  }, [deckName, speakWithLocale]);

  const dismissPicker = useCallback(() => {
    setShowPicker(false);
    pendingText.current = null;
  }, []);

  return { speak, locale, showPicker, selectLocale, dismissPicker, voices };
}
