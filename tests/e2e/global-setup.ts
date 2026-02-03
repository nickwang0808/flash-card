import { config } from 'dotenv';
import { setupTestRepo } from './test-server';
import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig) {
  config(); // load .env
  setupTestRepo();
}

export default globalSetup;
