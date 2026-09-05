import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['**/*.integration.test.*', 'tests/e2e/**'],
  },
});
