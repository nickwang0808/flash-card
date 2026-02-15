import { type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { readTestConfig } from './test-server';

function getConfig() {
  return readTestConfig();
}

/**
 * Creates a local git branch for test isolation.
 * Uses the local test repo instead of GitHub API.
 */
export async function createTestBranch(suiteName: string): Promise<string> {
  const { repoDir } = getConfig();
  const branchName = `test-${suiteName}-${Date.now()}`;
  execSync(`git branch "${branchName}" main`, { cwd: repoDir, stdio: 'pipe' });
  return branchName;
}

/**
 * Deletes a local test branch.
 */
export async function deleteTestBranch(branchName: string): Promise<void> {
  const { repoDir } = getConfig();
  try {
    // Make sure we're not on the branch we're deleting
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoDir,
      encoding: 'utf-8',
    }).trim();
    if (currentBranch === branchName) {
      execSync('git checkout main --quiet', { cwd: repoDir, stdio: 'pipe' });
    }
    execSync(`git branch -D "${branchName}"`, { cwd: repoDir, stdio: 'pipe' });
  } catch {
    // Ignore errors (branch might not exist)
  }
}

/**
 * Wipes all app data and reloads to show auth screen.
 */
export async function wipeAppData(page: Page) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs
        .filter((db) => db.name)
        .map(
          (db) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            }),
        ),
    );
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Connects to the local test git server by injecting settings directly
 * into RxDB (via window.__RXDB__), ending up on the deck list with seeded data.
 * Optionally uses a specific branch for test isolation.
 */
export async function cloneTestRepo(page: Page, branch?: string) {
  const { serverUrl } = getConfig();

  // Start fresh
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  // Clear any previous state
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs
        .filter((db) => db.name)
        .map(
          (db) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            }),
        ),
    );
  });

  // Reload so the app bootstraps fresh (creates RxDB and exposes window.__RXDB__)
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Wait for RxDB to be available
  await page.waitForFunction(() => !!(window as any).__RXDB__, { timeout: 10000 });

  // Inject settings directly into RxDB
  // Uses a fake github.com URL (parsed by parseRepoUrl) + apiBaseUrl pointing at local server
  await page.evaluate(
    async ({ apiBaseUrl, branchName }) => {
      const db = (window as any).__RXDB__;
      await db.settings.upsert({
        id: 'settings',
        repoUrl: 'https://github.com/test/flash-card-test',
        token: 'fake-token',
        newCardsPerDay: 10,
        reviewOrder: 'random',
        theme: 'system',
        apiBaseUrl,
        ...(branchName ? { branch: branchName } : {}),
      });
    },
    { apiBaseUrl: serverUrl, branchName: branch },
  );

  // Reload to trigger initial sync with the injected settings
  await page.reload();
  await page.waitForSelector('text=spanish-vocab', { timeout: 30000 });
}

