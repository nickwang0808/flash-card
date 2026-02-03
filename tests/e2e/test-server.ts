/**
 * Global setup/teardown for e2e tests.
 * Seeds a real GitHub repo with test card data, and cleans up after.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, '../../temp');
const WORK_DIR = path.join(TEMP_DIR, 'e2e-seed');

function getEnv() {
  const repoUrl = process.env.E2E_REPO_URL;
  const token = process.env.E2E_TOKEN;
  if (!repoUrl || !token) {
    throw new Error('E2E_REPO_URL and E2E_TOKEN must be set in .env');
  }
  return { repoUrl, token };
}

/** Build authenticated URL for git CLI operations */
function authUrl(repoUrl: string, token: string): string {
  const url = new URL(repoUrl);
  url.username = token;
  url.password = '';
  return url.toString();
}

const TEST_CARDS = {
  hola: { id: 'hola', source: 'hola', translation: 'hello', example: 'Hola, ¿cómo estás?', notes: 'Common greeting', tags: ['greeting'], created: '2025-01-01T00:00:00Z' },
  gato: { id: 'gato', source: 'gato', translation: 'cat', example: 'El gato está durmiendo.', tags: ['animal'], created: '2025-01-01T00:00:00Z', reversible: true },
  perro: { id: 'perro', source: 'perro', translation: 'dog', tags: ['animal'], created: '2025-01-02T00:00:00Z' },
  casa: { id: 'casa', source: 'casa', translation: 'house', created: '2025-01-03T00:00:00Z' },
  agua: { id: 'agua', source: 'agua', translation: 'water', created: '2025-01-04T00:00:00Z' },
};

/**
 * Clones the test repo, force-pushes seed data to main.
 * This gives every test run a clean starting point.
 */
export function setupTestRepo(): void {
  const { repoUrl, token } = getEnv();
  const remote = authUrl(repoUrl, token);

  fs.mkdirSync(TEMP_DIR, { recursive: true });
  if (fs.existsSync(WORK_DIR)) fs.rmSync(WORK_DIR, { recursive: true });

  // Init a fresh repo locally
  execSync(`git init "${WORK_DIR}"`);
  execSync(`git remote add origin "${remote}"`, { cwd: WORK_DIR });

  // Seed deck data
  const deckDir = path.join(WORK_DIR, 'spanish-vocab');
  fs.mkdirSync(deckDir);
  fs.writeFileSync(path.join(deckDir, 'cards.json'), JSON.stringify(TEST_CARDS, null, 2));
  fs.writeFileSync(path.join(deckDir, 'state.json'), '{}');

  execSync('git add .', { cwd: WORK_DIR });
  execSync('git commit -m "seed test data"', { cwd: WORK_DIR });
  execSync('git branch -M main', { cwd: WORK_DIR });
  execSync('git push --force origin main', { cwd: WORK_DIR });
}

/**
 * Deletes any sync/* branches and cleans up temp dir.
 */
export function cleanupTestRepo(): void {
  const { repoUrl, token } = getEnv();
  const remote = authUrl(repoUrl, token);

  try {
    // List remote branches matching sync/*
    const output = execSync(`git ls-remote --heads "${remote}"`, { cwd: WORK_DIR, encoding: 'utf-8' });
    const syncBranches = output
      .split('\n')
      .filter((line) => line.includes('refs/heads/sync/'))
      .map((line) => line.replace(/.*refs\/heads\//, ''));

    for (const branch of syncBranches) {
      try {
        execSync(`git push origin --delete "${branch}"`, { cwd: WORK_DIR });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore cleanup failures
  }

  if (fs.existsSync(WORK_DIR)) fs.rmSync(WORK_DIR, { recursive: true });
}
