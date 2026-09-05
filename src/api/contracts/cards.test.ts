import { describe, expect, it } from 'vitest';
import { CardCreateInputSchema } from './cards';

const deckId = '22222222-2222-4222-8222-222222222222';

describe('Card procedure contracts', () => {
  it('owns creation defaults at the procedure boundary', () => {
    expect(CardCreateInputSchema.parse({
      deckId,
      name: 'Apple — basic noun',
      frontMarkdown: 'front',
      backMarkdown: 'back',
    })).toEqual({
      deckId,
      name: 'Apple — basic noun',
      frontMarkdown: 'front',
      backMarkdown: 'back',
      tags: [],
      speechText: null,
      speechLocale: null,
    });
  });
});
