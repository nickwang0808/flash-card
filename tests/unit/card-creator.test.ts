import { describe, it, expect } from 'vitest';
import { buildCard } from '../../src/services/card-creator';

describe('buildCard', () => {
  it('builds a card with correct structure', () => {
    const card = buildCard({
      userId: 'user-123',
      deckName: 'spanish-vocab',
      term: 'perro',
      translation: 'dog',
    });

    expect(card.userId).toBe('user-123');
    expect(card.deckName).toBe('spanish-vocab');
    expect(card.term).toBe('perro');
    expect(card.front).toBe('perro');
    expect(card.back).toBe('dog');
    expect(card.reversible).toBe(true);
    expect(card.approved).toBe(false);
    expect(card.suspended).toBe(false);
    expect(card.order).toBe(0);
    expect(card.tags).toBe('[]');
    expect(card.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(card.created).toBeTruthy();
  });

  it('respects reversible override', () => {
    const card = buildCard({
      userId: 'user-123',
      deckName: 'test',
      term: 'hello',
      translation: 'hola',
      reversible: false,
    });

    expect(card.reversible).toBe(false);
  });

  it('generates unique IDs', () => {
    const a = buildCard({ userId: 'u', deckName: 'd', term: 'a', translation: 'b' });
    const b = buildCard({ userId: 'u', deckName: 'd', term: 'a', translation: 'b' });
    expect(a.id).not.toBe(b.id);
  });
});
