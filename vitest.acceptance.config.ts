import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['supabase/functions/api/acceptance/**/*.acceptance.test.ts'],
    minWorkers: 1,
    maxWorkers: 4,
    maxConcurrency: 8,
    fileParallelism: true,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
