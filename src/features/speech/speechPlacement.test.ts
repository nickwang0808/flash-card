import { describe, expect, it } from 'vitest';

import { visibleSpeechSide } from './speechPlacement.ts';

describe('visibleSpeechSide', () => {
  it('keeps speech attached to its visible queue side', () => {
    expect(visibleSpeechSide({ speechSide: 'front' }, true)).toBe('front');
    expect(visibleSpeechSide({ speechSide: 'back' }, true)).toBe('back');
  });

  it('hides speech when locale resolution cannot produce a request', () => {
    expect(visibleSpeechSide({ speechSide: 'back' }, false)).toBeNull();
    expect(visibleSpeechSide({ speechSide: null }, true)).toBeNull();
  });
});
