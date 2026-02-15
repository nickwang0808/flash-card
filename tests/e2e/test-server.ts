/**
 * Global setup/teardown for e2e tests.
 * Creates a local git repo with seed data and starts a local HTTP server
 * that mocks the GitHub Contents API. No real GitHub connection needed.
 *
 * Config is written to a temp file so test workers can read it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createTestRepo, startGitTestServer } from '../helpers/git-test-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.resolve(__dirname, '../../temp/e2e-config.json');

const TEST_CARDS = {
  hola: { source: 'hola', translation: 'hello', example: 'Hola, ¿cómo estás?', notes: 'Common greeting', tags: ['greeting'], created: '2025-01-01T00:00:00Z', state: null, reverseState: null },
  gato: { source: 'gato', translation: 'cat', example: 'El gato está durmiendo.', tags: ['animal'], created: '2025-01-01T12:00:00Z', reversible: true, state: null, reverseState: null },
  perro: { source: 'perro', translation: 'dog', tags: ['animal'], created: '2025-01-02T00:00:00Z', state: null, reverseState: null },
  casa: { source: 'casa', translation: 'house', created: '2025-01-03T00:00:00Z', state: null, reverseState: null },
  agua: { source: 'agua', translation: 'water', created: '2025-01-04T00:00:00Z', state: null, reverseState: null },
};

let repoCleanup: (() => void) | null = null;
let serverClose: (() => Promise<void>) | null = null;

export function readTestConfig(): { serverUrl: string; repoDir: string } {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(raw);
}

export function setupTestRepo(): void {
  const repo = createTestRepo({ 'spanish-vocab': TEST_CARDS });
  repoCleanup = repo.cleanup;

  // Ensure temp dir exists and write config
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ repoDir: repo.dir, serverUrl: '' }));
}

export async function startServer(): Promise<void> {
  const config = readTestConfig();
  const server = await startGitTestServer(config.repoDir);
  serverClose = server.close;

  // Update config with server URL
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ repoDir: config.repoDir, serverUrl: server.url }));
}

export function cleanupTestRepo(): void {
  repoCleanup?.();
  repoCleanup = null;
  try {
    fs.unlinkSync(CONFIG_FILE);
  } catch {
    // ignore
  }
}

export async function stopServer(): Promise<void> {
  await serverClose?.();
  serverClose = null;
}
