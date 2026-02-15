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

export const TEST_CARDS = {
  hola: { back: 'hello\n\n*Hola, ¿cómo estás?*\n\n> Common greeting', tags: ['greeting'], created: '2025-01-01T00:00:00Z', reversible: true, state: null, reverseState: null },
  gato: { back: '# cat\n\n*El gato está durmiendo.*', tags: ['animal'], created: '2025-01-01T12:00:00Z', reversible: true, state: null, reverseState: null },
  perro: { back: 'dog', tags: ['animal'], created: '2025-01-02T00:00:00Z', reversible: true, state: null, reverseState: null },
  rojo: { back: 'red', tags: ['color'], created: '2025-01-02T12:00:00Z', reversible: true, state: null, reverseState: null },
  casa: { back: 'house', created: '2025-01-03T00:00:00Z', reversible: true, state: null, reverseState: null },
  agua: { back: 'water', created: '2025-01-04T00:00:00Z', reversible: true, state: null, reverseState: null },
  libro: { back: 'book', created: '2025-01-05T00:00:00Z', reversible: true, state: null, reverseState: null },
  amigo: { back: 'friend', created: '2025-01-06T00:00:00Z', reversible: true, state: null, reverseState: null },
  comida: { back: 'food', created: '2025-01-07T00:00:00Z', reversible: true, state: null, reverseState: null },
  ciudad: { back: 'city', created: '2025-01-08T00:00:00Z', reversible: true, state: null, reverseState: null },
  tiempo: { back: 'time', created: '2025-01-09T00:00:00Z', reversible: true, state: null, reverseState: null },
  familia: { back: 'family', created: '2025-01-10T00:00:00Z', reversible: true, state: null, reverseState: null },
  grande: { back: 'big', created: '2025-01-11T00:00:00Z', reversible: true, state: null, reverseState: null },
  verde: { back: 'green', created: '2025-01-12T00:00:00Z', reversible: true, state: null, reverseState: null },
  blanco: { back: 'white', created: '2025-01-13T00:00:00Z', reversible: true, state: null, reverseState: null },
  comer: { back: 'to eat', created: '2025-01-14T00:00:00Z', reversible: true, state: null, reverseState: null },
  dormir: { back: 'to sleep', created: '2025-01-15T00:00:00Z', reversible: true, state: null, reverseState: null },
  correr: { back: 'to run', created: '2025-01-16T00:00:00Z', reversible: true, state: null, reverseState: null },
  hablar: { back: 'to speak', created: '2025-01-17T00:00:00Z', reversible: true, state: null, reverseState: null },
  vivir: { back: 'to live', created: '2025-01-18T00:00:00Z', reversible: true, state: null, reverseState: null },
  trabajo: { back: 'work', created: '2025-01-19T00:00:00Z', reversible: true, state: null, reverseState: null },
  escuela: { back: 'school', created: '2025-01-20T00:00:00Z', reversible: true, state: null, reverseState: null },
  hermano: { back: 'brother', created: '2025-01-21T00:00:00Z', reversible: true, state: null, reverseState: null },
  madre: { back: 'mother', created: '2025-01-22T00:00:00Z', reversible: true, state: null, reverseState: null },
  padre: { back: 'father', created: '2025-01-23T00:00:00Z', reversible: true, state: null, reverseState: null },
  noche: { back: 'night', created: '2025-01-24T00:00:00Z', reversible: true, state: null, reverseState: null },
  'mañana': { back: 'morning', created: '2025-01-25T00:00:00Z', reversible: true, state: null, reverseState: null },
  dinero: { back: 'money', created: '2025-01-26T00:00:00Z', reversible: true, state: null, reverseState: null },
  puerta: { back: 'door', created: '2025-01-27T00:00:00Z', reversible: true, state: null, reverseState: null },
  ventana: { back: 'window', created: '2025-01-28T00:00:00Z', reversible: true, state: null, reverseState: null },
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
