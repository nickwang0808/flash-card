import { setupTestRepo, startServer } from './test-server';
import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig) {
  setupTestRepo();
  await startServer();
}

export default globalSetup;
