import { useState, useEffect, useCallback, useRef } from 'react';

function localStorageKey(deckName: string): string {
  return `tts-locale:${deckName}`;
}

function useAvailableVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    function update() {
      setVoices(speechSynthesis.getVoices());
    }
    update();
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  return voices;
}

export function useTts(deckName: string) {
  const [locale, setLocale] = useState<string | null>(() =>
    localStorage.getItem(localStorageKey(deckName))
  );
  const [showPicker, setShowPicker] = useState(false);
  const pendingText = useRef<string | null>(null);
  const voices = useAvailableVoices();

  // Sync locale from localStorage when deckName changes
  useEffect(() => {
    setLocale(localStorage.getItem(localStorageKey(deckName)));
  }, [deckName]);

  const speakWithLocale = useCallback((text: string, lang: string) => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    // Prefer a voice matching the exact locale
    const match = voices.find(v => v.lang === lang);
    if (match) utterance.voice = match;
    speechSynthesis.speak(utterance);
  }, [voices]);

  const speak = useCallback((text: string) => {
    if (locale) {
      speakWithLocale(text, locale);
    } else {
      pendingText.current = text;
      setShowPicker(true);
    }
  }, [locale, speakWithLocale]);

  const selectLocale = useCallback((lang: string) => {
    localStorage.setItem(localStorageKey(deckName), lang);
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
