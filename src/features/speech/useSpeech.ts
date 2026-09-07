import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SpeechRequest } from './speechRequest.ts';


export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const utteranceId = useRef(0);

  const stop = useCallback(() => {
    utteranceId.current += 1;
    setIsSpeaking(false);
    return Speech.stop();
  }, []);

  const speak = useCallback(({ text, locale }: SpeechRequest) => {
    if (text.length > Speech.maxSpeechInputLength) {
      setError(new Error(`Pronunciation is too long for this device (${Speech.maxSpeechInputLength} characters maximum).`));
      return;
    }

    const id = utteranceId.current + 1;
    utteranceId.current = id;
    setError(null);
    setIsSpeaking(true);
    void Speech.stop();

    try {
      Speech.speak(text, {
        language: locale,
        onDone: () => {
          if (utteranceId.current === id) setIsSpeaking(false);
        },
        onStopped: () => {
          if (utteranceId.current === id) setIsSpeaking(false);
        },
        onError: (cause) => {
          if (utteranceId.current !== id) return;
          setIsSpeaking(false);
          setError(cause instanceof Error ? cause : new Error('Could not play pronunciation.'));
        },
      });
    } catch (cause) {
      if (utteranceId.current !== id) return;
      setIsSpeaking(false);
      setError(cause instanceof Error ? cause : new Error('Could not play pronunciation.'));
    }
  }, []);

  useEffect(() => () => { void stop(); }, [stop]);

  return { error, isSpeaking, speak, stop };
}
