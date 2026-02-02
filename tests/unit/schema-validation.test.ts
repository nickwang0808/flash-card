import { describe, it, expect } from 'vitest';
import { testCards } from '../fixtures/cards';
import { testState } from '../fixtures/state';

describe('Schema validation', () => {
  describe('cards.json schema', () => {
    it('all cards have required fields', () => {
      for (const [key, card] of Object.entries(testCards)) {
        expect(card.id).toBe(key);
        expect(typeof card.source).toBe('string');
        expect(typeof card.translation).toBe('string');
        expect(typeof card.created).toBe('string');
        // Validate ISO date
        expect(new Date(card.created).getTime()).not.toBeNaN();
      }
    });

    it('optional fields have correct types when present', () => {
      for (const card of Object.values(testCards)) {
        if (card.example !== undefined) expect(typeof card.example).toBe('string');
        if (card.notes !== undefined) expect(typeof card.notes).toBe('string');
        if (card.tags !== undefined) expect(Array.isArray(card.tags)).toBe(true);
        if ('reversible' in card) expect(typeof card.reversible).toBe('boolean');
      }
    });
  });

  describe('state.json schema', () => {
    it('all state entries have required FSRS fields', () => {
      for (const state of Object.values(testState)) {
        expect(typeof state.due).toBe('string');
        expect(typeof state.stability).toBe('number');
        expect(typeof state.difficulty).toBe('number');
        expect(typeof state.elapsed_days).toBe('number');
        expect(typeof state.scheduled_days).toBe('number');
        expect(typeof state.reps).toBe('number');
        expect(typeof state.lapses).toBe('number');
        expect(typeof state.state).toBe('number');
        expect(typeof state.suspended).toBe('boolean');
      }
    });

    it('state keys reference existing cards or reverse cards', () => {
      for (const key of Object.keys(testState)) {
        const baseKey = key.replace(/:reverse$/, '');
        expect(testCards).toHaveProperty(baseKey);
        if (key.endsWith(':reverse')) {
          const card = testCards[baseKey as keyof typeof testCards];
          expect((card as any).reversible).toBe(true);
        }
      }
    });
  });
});
