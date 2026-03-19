import { cleanupTestData } from './test-server';

async function globalTeardown() {
  await cleanupTestData();
}

export default globalTeardown;
