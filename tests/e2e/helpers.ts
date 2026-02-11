import { type Page } from '@playwright/test';
import { Octokit } from '@octokit/rest';

const E2E_REPO_URL = process.env.E2E_REPO_URL || 'https://github.com/nickwang0808/flash-card-test';
const E2E_TOKEN = process.env.E2E_TOKEN || '';

export { E2E_REPO_URL, E2E_TOKEN };

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2] };
}

/**
 * Creates a unique test branch from main for test isolation.
 * Returns the branch name.
 */
export async function createTestBranch(suiteName: string): Promise<string> {
  const { owner, repo } = parseRepoUrl(E2E_REPO_URL);
  const octokit = new Octokit({ auth: E2E_TOKEN });
  const branchName = `test-${suiteName}-${Date.now()}`;

  // Get the SHA of main branch
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: 'heads/main',
  });

  // Create the new branch
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: refData.object.sha,
  });

  return branchName;
}

/**
 * Deletes a test branch.
 */
export async function deleteTestBranch(branchName: string): Promise<void> {
  const { owner, repo } = parseRepoUrl(E2E_REPO_URL);
  const octokit = new Octokit({ auth: E2E_TOKEN });

  try {
    await octokit.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
    });
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
    // Clear IndexedDB for offline-transactions
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Connects to the real GitHub test repo by injecting settings directly
 * into localStorage (bypasses OAuth screen), ending up on the deck list
 * with seeded data.
 * Optionally uses a specific branch for test isolation.
 */
export async function cloneTestRepo(page: Page, branch?: string) {
  // Start fresh
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  // Clear any previous state
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });

  // Inject settings directly into localStorage (TanStack DB format)
  await page.evaluate(
    ({ repoUrl, token, branchName }) => {
      const settings: Record<string, unknown> = {
        's:settings': {
          versionKey: crypto.randomUUID(),
          data: {
            id: 'settings',
            repoUrl,
            token,
            newCardsPerDay: 10,
            reviewOrder: 'random',
            theme: 'system',
            ...(branchName ? { branch: branchName } : {}),
          },
        },
      };
      localStorage.setItem('flash-card-settings', JSON.stringify(settings));
    },
    { repoUrl: E2E_REPO_URL, token: E2E_TOKEN, branchName: branch },
  );

  // Reload to pick up injected settings and trigger initial sync
  await page.reload();
  await page.waitForSelector('text=spanish-vocab', { timeout: 30000 });
}

/**
 * Gets pending transaction count from the UI (displayed in various screens).
 * Since offline-transactions uses IndexedDB which is harder to query directly,
 * we rely on the UI showing the pending count.
 */
export async function getPendingCountFromUI(page: Page): Promise<number> {
  // Look for the "X pending" text in the UI
  const pendingText = await page.locator('text=/\\d+ pending/').textContent();
  if (!pendingText) return 0;
  const match = pendingText.match(/(\d+) pending/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Check if pending reviews message is visible.
 */
export async function hasPendingReviewsVisible(page: Page): Promise<boolean> {
  const pendingLocator = page.locator('text=/\\d+ reviews? pending sync/');
  return pendingLocator.isVisible().catch(() => false);
}
