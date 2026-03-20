import { type Page } from '@playwright/test';
import { resetTestData, TEST_USER_EMAIL, TEST_USER_PASSWORD } from './test-server';

/**
 * Resets Supabase test data (clears + re-seeds cards).
 * Replaces the old createTestBranch/deleteTestBranch git approach.
 */
export async function resetTestDB(): Promise<void> {
  await resetTestData();
}

/**
 * Wipes all app data and reloads to show auth screen.
 */
export async function wipeAppData(page: Page) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    // Sign out if there's a Supabase session
    if ((window as any).__SUPABASE__) {
      await (window as any).__SUPABASE__.auth.signOut();
    }
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
 * Signs in with the dev test user, syncs cards from Supabase,
 * and lands on the deck list with seeded data.
 * Replaces the old cloneTestRepo helper.
 */
export async function cloneTestRepo(page: Page) {
  // Start fresh
  await wipeAppData(page);

  // Wait for RxDB and Supabase client to be available
  await page.waitForFunction(
    () => !!(window as any).__RXDB__ && !!(window as any).__SUPABASE__,
    { timeout: 10000 },
  );

  // Sign in with the test user via the app's Supabase client
  await page.evaluate(
    async ({ email, password }) => {
      const supabase = (window as any).__SUPABASE__;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // User might not exist yet — sign up
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
      }
    },
    { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
  );

  // Reload to trigger auth detection + initial sync
  await page.reload();
  await page.waitForSelector('text=spanish-vocab', { timeout: 30000 });
}
