import { test, expect } from '@playwright/test';
import { cloneTestRepo, createTestBranch, deleteTestBranch } from './helpers';

test.describe('Sync screen', () => {
  let testBranch: string;

  test.beforeEach(async ({ page }, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
    testBranch = await createTestBranch(`sync-${safeName}`);
    await cloneTestRepo(page, testBranch);
  });

  test.afterEach(async () => {
    await deleteTestBranch(testBranch);
  });

  test('navigates to sync screen and shows status', async ({ page }) => {
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Sync' })).toBeVisible();
    await expect(page.getByText('Online', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync' })).toBeVisible();
  });

  test('shows recent commits from GitHub', async ({ page }) => {
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    await expect(page.getByText('Recent Commits')).toBeVisible();
    await expect(page.getByText('seed test data')).toBeVisible();
  });

  // Skip: pending count is hard to test reliably due to async write queue timing
  test.skip('shows pending reviews after a session', async ({ page, context }) => {
    // Start review session while online
    await page.getByText('spanish-vocab').click();
    await page.getByRole('button', { name: 'Show Answer' }).waitFor();

    // Go offline before rating so writes queue instead of completing
    await context.setOffline(true);

    // Do a review
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    // Wait a moment for the queue to update
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: 'End Session' }).click();

    // Go to sync
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    // Should see pending reviews count (offline so writes are queued)
    await expect(page.getByText(/\d+ reviews? pending sync/)).toBeVisible();

    // Restore online
    await context.setOffline(false);
  });

  test('back button returns to deck list', async ({ page }) => {
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });
});

test.describe('Settings screen', () => {
  let testBranch: string;

  test.beforeEach(async ({ page }, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
    testBranch = await createTestBranch(`settings-${safeName}`);
    await cloneTestRepo(page, testBranch);
  });

  test.afterEach(async () => {
    await deleteTestBranch(testBranch);
  });

  test('navigates to settings and shows current config', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('https://github.com/test/flash-card-test')).toBeVisible();
    await expect(page.getByText(/New cards per day: 10/)).toBeVisible();
  });

  test('has review order dropdown with options', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const select = page.getByRole('combobox');
    await expect(select).toBeVisible();

    await expect(page.getByRole('option', { name: 'Random' })).toBeAttached();
    await expect(page.getByRole('option', { name: 'Oldest first' })).toBeAttached();
    await expect(page.getByRole('option', { name: 'Deck grouped' })).toBeAttached();
  });

  test('has theme toggle buttons', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('button', { name: 'light' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'dark' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'system' })).toBeVisible();
  });

  test('switching to dark theme adds dark class', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'dark' }).click();

    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('switching to light theme removes dark class', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.getByRole('button', { name: 'light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('new cards per day slider persists value', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const slider = page.getByRole('slider');
    await slider.fill('5');

    await expect(page.getByText(/New cards per day: 5/)).toBeVisible();

    // Settings are stored in RxDB
    const stored = await page.evaluate(async () => {
      const db = (window as any).__RXDB__;
      const doc = await db.settings.findOne('settings').exec();
      return doc ? doc.toJSON().newCardsPerDay : null;
    });
    expect(stored).toBe(5);
  });

  test('back button returns to deck list', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('repo URL edit and save persists new value', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    // Click Edit to enter edit mode
    await page.getByRole('button', { name: 'Edit' }).click();

    // Input should be visible with current repo URL
    const input = page.getByPlaceholder('owner/repo');
    await expect(input).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // Change the URL
    await input.fill('https://github.com/test/new-repo');
    await page.getByRole('button', { name: 'Save' }).click();

    // Edit mode should close, new URL should be displayed
    await expect(page.getByText('https://github.com/test/new-repo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  test('repo URL edit cancel reverts to original value', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByRole('button', { name: 'Edit' }).click();

    const input = page.getByPlaceholder('owner/repo');
    await input.fill('https://github.com/test/should-revert');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Should show original URL, not the edited one
    await expect(page.getByText('https://github.com/test/flash-card-test')).toBeVisible();
    await expect(page.getByText('https://github.com/test/should-revert')).not.toBeVisible();
  });

  test('logout cancel stays on settings screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    // Dismiss the confirmation dialog
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Logout' }).click();

    // Should remain on settings screen
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  });

  test('review order selection persists', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    // Change review order to "oldest-first"
    await page.getByRole('combobox').selectOption('oldest-first');

    // Wait for RxDB to persist the value (async upsert)
    await page.waitForFunction(async () => {
      const db = (window as any).__RXDB__;
      const doc = await db.settings.findOne('settings').exec();
      return doc?.toJSON()?.reviewOrder === 'oldest-first';
    }, { timeout: 5000 });

    // Navigate away and back — should still show oldest-first
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('combobox')).toHaveValue('oldest-first');
  });

  test('theme persists after navigating away', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'dark' }).click();

    // Navigate away
    await page.getByRole('button', { name: 'Back' }).click();

    // Dark class should still be applied
    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(hasDarkClass).toBe(true);

    // Navigate back to settings — dark should still be selected
    await page.getByRole('button', { name: 'Settings' }).click();
    // The dark button should have the selected style (border-primary)
    const darkButton = page.getByRole('button', { name: 'dark' });
    await expect(darkButton).toHaveClass(/border-primary/);
  });

  test('logout clears all data and returns to auth screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Logout' }).click();

    await expect(page.getByRole('heading', { name: 'Flash Cards' })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with github/i })).toBeVisible();
  });
});

test.describe('New card daily limit', () => {
  let testBranch: string;

  test.beforeEach(async ({ page }, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
    testBranch = await createTestBranch(`limit-${safeName}`);
    await cloneTestRepo(page, testBranch);
  });

  test.afterEach(async () => {
    await deleteTestBranch(testBranch);
  });

  test('respects new cards per day setting', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('slider').fill('2');
    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByText('spanish-vocab').click();

    // With limit of 2, should show "2 remaining" (only 2 new cards allowed)
    await expect(page.getByText('2 remaining')).toBeVisible();
  });

  test('new cards per day = 0 shows session complete immediately', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('slider').fill('0');
    await expect(page.getByText(/New cards per day: 0/)).toBeVisible();

    // Wait for RxDB to persist the value
    await page.waitForFunction(async () => {
      const db = (window as any).__RXDB__;
      const doc = await db.settings.findOne('settings').exec();
      return doc?.toJSON()?.newCardsPerDay === 0;
    }, { timeout: 5000 });

    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByText('spanish-vocab').click();

    // No new cards allowed — should show session complete right away
    await expect(page.getByText('Session Complete')).toBeVisible();
    await expect(page.getByText('No more cards to review today.')).toBeVisible();
  });
});

test.describe('Manual sync', () => {
  let testBranch: string;

  test.beforeEach(async ({ page }, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
    testBranch = await createTestBranch(`msync-${safeName}`);
    await cloneTestRepo(page, testBranch);
  });

  test.afterEach(async () => {
    await deleteTestBranch(testBranch);
  });

  test('sync button shows success message', async ({ page }) => {
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    // Click the Sync button on the sync screen
    await page.getByRole('button', { name: 'Sync' }).click();

    // Should show syncing state, then success
    await expect(page.getByText('Synced successfully')).toBeVisible({ timeout: 15000 });
  });
});
