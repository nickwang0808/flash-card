import { describe, it, expect, vi } from 'vitest';
import { GitHubStorageService } from '../../src/services/github';

// Mock Octokit to return controlled data
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      getContent: vi.fn(),
    },
  })),
}));

function base64Encode(str: string): string {
  // Node-compatible base64 encoding
  return Buffer.from(str, 'utf-8').toString('base64');
}

describe('GitHubStorageService.pullAllCards', () => {
  it('assigns sequential order to cards based on JSON key position', async () => {
    const cardsJson = JSON.stringify({
      hola: { back: 'hello', created: '2025-01-01', state: null, reverseState: null },
      gato: { back: 'cat', created: '2025-01-01', state: null, reverseState: null },
      perro: { back: 'dog', created: '2025-01-01', state: null, reverseState: null },
      casa: { back: 'house', created: '2025-01-01', state: null, reverseState: null },
      agua: { back: 'water', created: '2025-01-01', state: null, reverseState: null },
    });

    const service = new GitHubStorageService({
      owner: 'test',
      repo: 'test-repo',
      token: 'fake-token',
    });

    // Mock listDirectory (root) to return one deck dir
    const mockGetContent = (service as any).octokit.repos.getContent;
    mockGetContent.mockImplementation(({ path }: { path: string }) => {
      if (path === '') {
        // Root directory listing
        return { data: [{ name: 'spanish-vocab', type: 'dir' }] };
      }
      if (path === 'spanish-vocab/cards.json') {
        // File content
        return {
          data: {
            type: 'file',
            content: base64Encode(cardsJson),
            sha: 'abc123',
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const cards = await service.pullAllCards();

    expect(cards).toHaveLength(5);
    expect(cards.map((c) => ({ term: c.term, order: c.order }))).toEqual([
      { term: 'hola', order: 0 },
      { term: 'gato', order: 1 },
      { term: 'perro', order: 2 },
      { term: 'casa', order: 3 },
      { term: 'agua', order: 4 },
    ]);
  });

  it('resets order to 0 for each deck', async () => {
    const deck1Json = JSON.stringify({
      hola: { back: 'hello', created: '2025-01-01', state: null, reverseState: null },
      gato: { back: 'cat', created: '2025-01-01', state: null, reverseState: null },
    });
    const deck2Json = JSON.stringify({
      one: { back: '一', created: '2025-01-01', state: null, reverseState: null },
      two: { back: '二', created: '2025-01-01', state: null, reverseState: null },
      three: { back: '三', created: '2025-01-01', state: null, reverseState: null },
    });

    const service = new GitHubStorageService({
      owner: 'test',
      repo: 'test-repo',
      token: 'fake-token',
    });

    const mockGetContent = (service as any).octokit.repos.getContent;
    mockGetContent.mockImplementation(({ path }: { path: string }) => {
      if (path === '') {
        return { data: [
          { name: 'spanish-vocab', type: 'dir' },
          { name: 'chinese-numbers', type: 'dir' },
        ]};
      }
      if (path === 'spanish-vocab/cards.json') {
        return { data: { type: 'file', content: base64Encode(deck1Json), sha: 'a' } };
      }
      if (path === 'chinese-numbers/cards.json') {
        return { data: { type: 'file', content: base64Encode(deck2Json), sha: 'b' } };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const cards = await service.pullAllCards();

    // Each deck's order starts at 0
    const chinese = cards.filter((c) => c.deckName === 'chinese-numbers');
    expect(chinese.map((c) => ({ term: c.term, order: c.order }))).toEqual([
      { term: 'one', order: 0 },
      { term: 'two', order: 1 },
      { term: 'three', order: 2 },
    ]);

    const spanish = cards.filter((c) => c.deckName === 'spanish-vocab');
    expect(spanish.map((c) => ({ term: c.term, order: c.order }))).toEqual([
      { term: 'hola', order: 0 },
      { term: 'gato', order: 1 },
    ]);
  });

  it('skips $schema keys without affecting order numbering', async () => {
    const cardsJson = JSON.stringify({
      $schema: '../schema/cards.schema.json',
      hola: { back: 'hello', created: '2025-01-01', state: null, reverseState: null },
      gato: { back: 'cat', created: '2025-01-01', state: null, reverseState: null },
    });

    const service = new GitHubStorageService({
      owner: 'test',
      repo: 'test-repo',
      token: 'fake-token',
    });

    const mockGetContent = (service as any).octokit.repos.getContent;
    mockGetContent.mockImplementation(({ path }: { path: string }) => {
      if (path === '') {
        return { data: [{ name: 'deck', type: 'dir' }] };
      }
      if (path === 'deck/cards.json') {
        return { data: { type: 'file', content: base64Encode(cardsJson), sha: 'a' } };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const cards = await service.pullAllCards();

    expect(cards).toHaveLength(2);
    expect(cards[0].order).toBe(0);
    expect(cards[1].order).toBe(1);
  });
});

// ============================================================================
// JSON.parse + Object.entries order determinism
// ============================================================================

describe('JSON key order determinism', () => {
  // JSON.parse → Object.entries must preserve declaration order for our
  // order-assignment strategy to work. The JS spec guarantees insertion
  // order for non-integer-index string keys. These tests verify that
  // guarantee holds for realistic card term patterns.

  function keysFromJson(json: string): string[] {
    return Object.keys(JSON.parse(json));
  }

  it('preserves order for Latin alphabet terms', () => {
    const json = '{"hola":1,"gato":2,"perro":3,"casa":4,"agua":5}';
    expect(keysFromJson(json)).toEqual(['hola', 'gato', 'perro', 'casa', 'agua']);
  });

  it('preserves order for CJK characters', () => {
    const json = '{"一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10}';
    expect(keysFromJson(json)).toEqual(['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']);
  });

  it('preserves order for mixed scripts (Spanish, Japanese, Arabic)', () => {
    const json = '{"مرحبا":1,"こんにちは":2,"hola":3,"你好":4}';
    expect(keysFromJson(json)).toEqual(['مرحبا', 'こんにちは', 'hola', '你好']);
  });

  it('preserves order for multi-word phrases', () => {
    const json = '{"buenos días":1,"buenas noches":2,"por favor":3,"muchas gracias":4}';
    expect(keysFromJson(json)).toEqual(['buenos días', 'buenas noches', 'por favor', 'muchas gracias']);
  });

  it('preserves order for emoji keys', () => {
    const json = '{"🐱":1,"🐶":2,"🏠":3,"💧":4}';
    expect(keysFromJson(json)).toEqual(['🐱', '🐶', '🏠', '💧']);
  });

  it('WARNING: integer-like keys get sorted numerically (JS spec behavior)', () => {
    // This is a known JS spec behavior: array-index-like keys (non-negative
    // integers) are enumerated first in numeric order, before string keys.
    // Card terms like "1", "2", "10" would NOT preserve declaration order.
    const json = '{"10":1,"2":2,"1":3}';
    // JS sorts these numerically: 1, 2, 10 — NOT declaration order 10, 2, 1
    expect(keysFromJson(json)).toEqual(['1', '2', '10']);
  });

  it('is deterministic across 100 repeated parses', () => {
    const json = '{"一":1,"二":2,"三":3,"四":4,"五":5}';
    const expected = ['一', '二', '三', '四', '五'];
    for (let i = 0; i < 100; i++) {
      expect(keysFromJson(json)).toEqual(expected);
    }
  });
});
