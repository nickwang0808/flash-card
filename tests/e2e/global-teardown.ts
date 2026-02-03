import { config } from 'dotenv';
import { cleanupTestRepo } from './test-server';

async function globalTeardown() {
  config(); // load .env
  cleanupTestRepo();
}

export default globalTeardown;
