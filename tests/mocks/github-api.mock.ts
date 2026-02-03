import { vi } from 'vitest';

const files: Record<string, { content: string; sha: string }> = {};
let shaCounter = 0;

function nextSha(): string {
  return `sha-${++shaCounter}`;
}

export const mockGithubApi = {
  validateRepo: vi.fn().mockResolvedValue(true),

  readFile: vi.fn().mockImplementation(async (_config: any, path: string) => {
    if (files[path]) return { content: files[path].content, sha: files[path].sha };
    throw new Error(`File not found: ${path}`);
  }),

  writeFile: vi.fn().mockImplementation(async (_config: any, path: string, content: string, _sha: string, _message: string) => {
    const sha = nextSha();
    files[path] = { content, sha };
    return sha;
  }),

  listDirectory: vi.fn().mockResolvedValue([]),

  getCommits: vi.fn().mockResolvedValue([]),

  // Test helpers
  _setFile(path: string, content: string) {
    files[path] = { content, sha: nextSha() };
  },
  _getFile(path: string) {
    return files[path];
  },
  _clearFiles() {
    for (const key of Object.keys(files)) delete files[key];
    shaCounter = 0;
  },
};
