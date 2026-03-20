import { setupTestData } from './test-server';
import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig) {
  await setupTestData();
}

export default globalSetup;
