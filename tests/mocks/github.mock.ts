import { vi } from 'vitest';

const files: Record<string, { content: string; sha: string }> = {};

export const mockGithub = {
  validateRepo: vi.fn().mockResolvedValue(true),

  listDirectory: vi.fn().mockImplementation(async (_config: any, _path: string) => {
    return [{ name: 'test-deck', type: 'dir' }];
  }),

  readFile: vi.fn().mockImplementation(async (_config: any, path: string) => {
    if (files[path]) {
      return { content: files[path].content, sha: files[path].sha };
    }
    throw new Error(`File not found: ${path}`);
  }),

  writeFile: vi.fn().mockImplementation(async (_config: any, path: string, content: string, _sha: string | undefined, _message: string) => {
    const newSha = `sha-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    files[path] = { content, sha: newSha };
    return newSha;
  }),

  getCommits: vi.fn().mockResolvedValue([
    { message: 'Initial commit', sha: 'abc1234', date: '2024-01-01T00:00:00Z' },
  ]),

  // Test helpers
  _setFile(path: string, content: string) {
    const sha = `sha-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    files[path] = { content, sha };
  },

  _clearFiles() {
    for (const key of Object.keys(files)) {
      delete files[key];
    }
  },

  _getFile(path: string) {
    return files[path];
  },
};

export const mockParseRepoUrl = vi.fn().mockReturnValue({ owner: 'test', repo: 'repo' });
export const mockGetConfig = vi.fn().mockReturnValue({ owner: 'test', repo: 'repo', token: 'test-token' });
