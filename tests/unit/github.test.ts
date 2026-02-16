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
