import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FlashCard } from '../../src/services/collections';

// Mock dependencies before importing the service
vi.mock('../../src/services/github', () => ({
  github: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listDirectory: vi.fn(),
  },
  parseRepoUrl: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
}));

vi.mock('../../src/hooks/useSettings', () => ({
  settingsCollection: {
    state: {
      get: vi.fn(() => ({
        repoUrl: 'https://github.com/test-owner/test-repo',
        token: 'test-token',
        branch: 'main',
      })),
    },
  },
  defaultSettings: {
    repoUrl: '',
    token: '',
    branch: 'main',
  },
}));

import { github } from '../../src/services/github';
import { githubService } from '../../src/services/github-service';

// ============================================================================
// Test Helpers
// ============================================================================

function createFlashCard(source: string, overrides: Partial<FlashCard> = {}): FlashCard {
  return {
    source,
    translation: `${source}-translation`,
    tags: [],
    created: '2025-01-01',
    reversible: false,
    state: null,
    reverseState: null,
    ...overrides,
  };
}

// ============================================================================
// Batching Tests
// ============================================================================

describe('githubService.updateCards batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default mock: file exists with empty cards
    vi.mocked(github.readFile).mockResolvedValue({
      content: '{}',
      sha: 'abc123',
    });
    vi.mocked(github.writeFile).mockResolvedValue('new-sha-123');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('debounce behavior', () => {
    it('does not write immediately on updateCards call', async () => {
      const card = createFlashCard('hello');

      // Start the update but don't advance timers
      githubService.updateCards('test-deck', [card]);

      // Give any microtasks a chance to run
      await Promise.resolve();

      expect(github.writeFile).not.toHaveBeenCalled();
    });

    it('writes after 2 second delay', async () => {
      const card = createFlashCard('hello');

      githubService.updateCards('test-deck', [card]);

      // Advance time by 2 seconds
      await vi.advanceTimersByTimeAsync(2000);

      expect(github.writeFile).toHaveBeenCalledTimes(1);
    });

    it('resets timer on subsequent calls within window', async () => {
      const card1 = createFlashCard('hello');
      const card2 = createFlashCard('world');

      githubService.updateCards('test-deck', [card1]);

      // Wait 1 second (not enough to trigger flush)
      await vi.advanceTimersByTimeAsync(1000);
      expect(github.writeFile).not.toHaveBeenCalled();

      // Another update resets the timer
      githubService.updateCards('test-deck', [card2]);

      // Wait another 1 second (2 total, but only 1 since last update)
      await vi.advanceTimersByTimeAsync(1000);
      expect(github.writeFile).not.toHaveBeenCalled();

      // Wait remaining 1 second to complete the 2s window
      await vi.advanceTimersByTimeAsync(1000);
      expect(github.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('accumulation behavior', () => {
    it('batches multiple cards into single write', async () => {
      const card1 = createFlashCard('hello');
      const card2 = createFlashCard('world');
      const card3 = createFlashCard('foo');

      githubService.updateCards('test-deck', [card1]);
      githubService.updateCards('test-deck', [card2]);
      githubService.updateCards('test-deck', [card3]);

      await vi.advanceTimersByTimeAsync(2000);

      // Only one write call
      expect(github.writeFile).toHaveBeenCalledTimes(1);

      // All three cards should be in the written content
      const writtenContent = JSON.parse(
        vi.mocked(github.writeFile).mock.calls[0][2]
      );
      expect(Object.keys(writtenContent)).toHaveLength(3);
      expect(writtenContent['hello']).toBeDefined();
      expect(writtenContent['world']).toBeDefined();
      expect(writtenContent['foo']).toBeDefined();
    });

    it('latest update wins for same card', async () => {
      const card1 = createFlashCard('hello', { translation: 'first' });
      const card2 = createFlashCard('hello', { translation: 'second' });
      const card3 = createFlashCard('hello', { translation: 'third' });

      githubService.updateCards('test-deck', [card1]);
      githubService.updateCards('test-deck', [card2]);
      githubService.updateCards('test-deck', [card3]);

      await vi.advanceTimersByTimeAsync(2000);

      const writtenContent = JSON.parse(
        vi.mocked(github.writeFile).mock.calls[0][2]
      );

      // Only one 'hello' card with the latest translation
      expect(Object.keys(writtenContent)).toHaveLength(1);
      expect(writtenContent['hello'].translation).toBe('third');
    });

    it('handles array of multiple cards in single call', async () => {
      const cards = [
        createFlashCard('one'),
        createFlashCard('two'),
        createFlashCard('three'),
      ];

      githubService.updateCards('test-deck', cards);

      await vi.advanceTimersByTimeAsync(2000);

      const writtenContent = JSON.parse(
        vi.mocked(github.writeFile).mock.calls[0][2]
      );
      expect(Object.keys(writtenContent)).toHaveLength(3);
    });
  });

  describe('per-deck isolation', () => {
    it('maintains separate batches for different decks', async () => {
      const spanishCard = createFlashCard('hola');
      const frenchCard = createFlashCard('bonjour');

      githubService.updateCards('spanish', [spanishCard]);
      githubService.updateCards('french', [frenchCard]);

      await vi.advanceTimersByTimeAsync(2000);

      // Two separate writes
      expect(github.writeFile).toHaveBeenCalledTimes(2);

      // Verify each deck got its own card
      const calls = vi.mocked(github.writeFile).mock.calls;
      const spanishWrite = calls.find((c) => c[1].includes('spanish'));
      const frenchWrite = calls.find((c) => c[1].includes('french'));

      expect(spanishWrite).toBeDefined();
      expect(frenchWrite).toBeDefined();

      const spanishContent = JSON.parse(spanishWrite![2]);
      const frenchContent = JSON.parse(frenchWrite![2]);

      expect(spanishContent['hola']).toBeDefined();
      expect(spanishContent['bonjour']).toBeUndefined();
      expect(frenchContent['bonjour']).toBeDefined();
      expect(frenchContent['hola']).toBeUndefined();
    });

    it('debounce timers are independent per deck', async () => {
      const card1 = createFlashCard('hola');
      const card2 = createFlashCard('bonjour');

      githubService.updateCards('spanish', [card1]);

      // Wait 1 second
      await vi.advanceTimersByTimeAsync(1000);

      // Start french deck (has its own timer)
      githubService.updateCards('french', [card2]);

      // Wait 1 more second - spanish should flush (2s total)
      await vi.advanceTimersByTimeAsync(1000);

      expect(github.writeFile).toHaveBeenCalledTimes(1);
      expect(vi.mocked(github.writeFile).mock.calls[0][1]).toContain('spanish');

      // Wait 1 more second - french should flush
      await vi.advanceTimersByTimeAsync(1000);

      expect(github.writeFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('merge with existing content', () => {
    it('merges new cards with existing cards from GitHub', async () => {
      // Existing cards on GitHub
      vi.mocked(github.readFile).mockResolvedValue({
        content: JSON.stringify({
          existing: {
            source: 'existing',
            translation: 'already-there',
            tags: [],
            created: '2025-01-01',
            reversible: false,
            state: null,
            reverseState: null,
          },
        }),
        sha: 'sha123',
      });

      const newCard = createFlashCard('new-card');
      githubService.updateCards('test-deck', [newCard]);

      await vi.advanceTimersByTimeAsync(2000);

      const writtenContent = JSON.parse(
        vi.mocked(github.writeFile).mock.calls[0][2]
      );

      // Both existing and new cards present
      expect(writtenContent['existing']).toBeDefined();
      expect(writtenContent['new-card']).toBeDefined();
    });

    it('updates existing card when source matches', async () => {
      vi.mocked(github.readFile).mockResolvedValue({
        content: JSON.stringify({
          hello: {
            source: 'hello',
            translation: 'old-translation',
            tags: [],
            created: '2025-01-01',
            reversible: false,
            state: null,
            reverseState: null,
          },
        }),
        sha: 'sha123',
      });

      const updatedCard = createFlashCard('hello', {
        translation: 'new-translation',
      });
      githubService.updateCards('test-deck', [updatedCard]);

      await vi.advanceTimersByTimeAsync(2000);

      const writtenContent = JSON.parse(
        vi.mocked(github.writeFile).mock.calls[0][2]
      );

      expect(writtenContent['hello'].translation).toBe('new-translation');
    });

    it('passes SHA for optimistic locking', async () => {
      vi.mocked(github.readFile).mockResolvedValue({
        content: '{}',
        sha: 'specific-sha-456',
      });

      githubService.updateCards('test-deck', [createFlashCard('test')]);

      await vi.advanceTimersByTimeAsync(2000);

      expect(github.writeFile).toHaveBeenCalledWith(
        expect.any(Object),
        'test-deck/cards.json',
        expect.any(String),
        'specific-sha-456',
        expect.any(String)
      );
    });
  });

  describe('commit message', () => {
    it('includes deck name and card sources in commit message', async () => {
      const cards = [createFlashCard('hello'), createFlashCard('world')];
      githubService.updateCards('spanish', cards);

      await vi.advanceTimersByTimeAsync(2000);

      const commitMessage = vi.mocked(github.writeFile).mock.calls[0][4];
      expect(commitMessage).toContain('spanish');
      expect(commitMessage).toContain('hello');
      expect(commitMessage).toContain('world');
    });
  });

  describe('edge cases', () => {
    it('handles empty pending updates gracefully', async () => {
      // This shouldn't happen in practice, but ensure no errors
      await vi.advanceTimersByTimeAsync(2000);
      expect(github.writeFile).not.toHaveBeenCalled();
    });

    it('handles file not existing yet', async () => {
      vi.mocked(github.readFile).mockRejectedValue(new Error('Not found'));

      githubService.updateCards('new-deck', [createFlashCard('first-card')]);

      await vi.advanceTimersByTimeAsync(2000);

      // Should still write, with undefined SHA (creates new file)
      expect(github.writeFile).toHaveBeenCalledWith(
        expect.any(Object),
        'new-deck/cards.json',
        expect.any(String),
        undefined,
        expect.any(String)
      );
    });
  });
});
