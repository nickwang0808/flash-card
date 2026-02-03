import { type Page } from '@playwright/test';

const E2E_REPO_URL = process.env.E2E_REPO_URL || 'https://github.com/nickwang0808/flash-card-test';
const E2E_TOKEN = process.env.E2E_TOKEN || '';

export { E2E_REPO_URL, E2E_TOKEN };

/**
 * Wipes all app data and reloads to show auth screen.
 */
export async function wipeAppData(page: Page) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Connects to the real GitHub test repo via the auth screen,
 * ending up on the deck list with seeded data.
 */
export async function cloneTestRepo(page: Page) {
  // Start fresh
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  // Clear any previous state
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Should be on auth screen
  await page.getByPlaceholder(/github.com/i).fill(E2E_REPO_URL);
  await page.getByPlaceholder(/ghp_/).fill(E2E_TOKEN);
  await page.getByRole('button', { name: /connect/i }).click();

  // Wait for API fetch to complete and deck list to appear
  await page.waitForSelector('text=spanish-vocab', { timeout: 30000 });
}

/**
 * Reads the pending review count from localStorage.
 */
export async function getPendingCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('flash-card-pending-reviews');
    if (!raw) return 0;
    return JSON.parse(raw).length;
  });
}

/**
 * Reads state from the pending reviews queue in localStorage.
 */
export async function getPendingReviews(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('flash-card-pending-reviews');
    if (!raw) return [];
    return JSON.parse(raw);
  });
}
