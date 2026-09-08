// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  speak: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('expo-speech', () => ({
  maxSpeechInputLength: 100,
  speak: state.speak,
  stop: state.stop,
}));

beforeEach(() => {
  state.speak.mockClear();
  state.stop.mockClear();
});

import { useSpeech } from './useSpeech.ts';

describe('useSpeech', () => {
  it('replaces active speech and sends the portable locale to Expo', () => {
    const { result } = renderHook(() => useSpeech());

    act(() => result.current.speak({ text: 'hola', locale: 'es-ES' }));

    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.speak).toHaveBeenCalledWith('hola', expect.objectContaining({ language: 'es-ES' }));
    expect(result.current.isSpeaking).toBe(true);
  });

  it('stops playback when unmounted', () => {
    const { unmount } = renderHook(() => useSpeech());

    unmount();

    expect(state.stop).toHaveBeenCalledOnce();
  });
});
