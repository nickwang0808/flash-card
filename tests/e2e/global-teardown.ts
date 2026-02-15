import { cleanupTestRepo, stopServer } from './test-server';

async function globalTeardown() {
  await stopServer();
  cleanupTestRepo();
}

export default globalTeardown;
