import { describe, expect, it } from 'vitest';

import { resolveSpeechRequest } from './speechRequest.ts';

const card = {
  speechText: 'hola',
  speechLocale: null,
  speechSide: 'front' as const,
};

describe('resolveSpeechRequest', () => {
  it('uses the deck default when the card does not override it', () => {
    expect(resolveSpeechRequest(card, 'es-ES')).toEqual({ text: 'hola', locale: 'es-ES' });
  });

  it('prefers the card locale override', () => {
    expect(resolveSpeechRequest({ ...card, speechLocale: 'es-MX' }, 'es-ES')).toEqual({ text: 'hola', locale: 'es-MX' });
  });

  it('does not permit playback without complete speech configuration', () => {
    expect(resolveSpeechRequest({ ...card, speechSide: null }, 'es-ES')).toBeNull();
    expect(resolveSpeechRequest(card, null)).toBeNull();
  });
});
