import { vi } from 'vitest';

const files: Record<string, string> = {};

export const mockGitService = {
  clone: vi.fn().mockResolvedValue(undefined),
  pull: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
  pushAsBranch: vi.fn().mockResolvedValue('sync/test-branch'),
  readFile: vi.fn().mockImplementation(async (path: string) => {
    if (files[path] !== undefined) return files[path];
    throw new Error(`File not found: ${path}`);
  }),
  writeFile: vi.fn().mockImplementation(async (path: string, content: string) => {
    files[path] = content;
  }),
  commit: vi.fn().mockResolvedValue(undefined),
  hasUnpushedCommits: vi.fn().mockResolvedValue(false),
  getStatus: vi.fn().mockResolvedValue('synced' as const),
  listDirectories: vi.fn().mockResolvedValue([]),
  getLog: vi.fn().mockResolvedValue([]),
  isInitialized: vi.fn().mockResolvedValue(true),
  wipe: vi.fn().mockResolvedValue(undefined),
  getFS: vi.fn(),

  // Test helpers
  _setFile(path: string, content: string) {
    files[path] = content;
  },
  _clearFiles() {
    for (const key of Object.keys(files)) delete files[key];
  },
};
