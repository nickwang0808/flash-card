import { test, expect } from '@playwright/test';
import { cloneTestRepo, resetTestDB } from './helpers';

test.describe('Settings screen', () => {
  test.beforeEach(async ({ page }) => {
    await resetTestDB();
    await cloneTestRepo(page);
  });

  test('navigates to settings and shows current config', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Signed in via GitHub')).toBeVisible();
    await expect(page.getByRole('spinbutton')).toHaveValue('10');
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

  test('new cards per day input persists value', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const input = page.getByRole('spinbutton');
    await input.fill('25');
    await input.blur();

    await expect(input).toHaveValue('25');

    // Settings are stored in RxDB
    const stored = await page.evaluate(async () => {
      const db = (window as any).__RXDB__;
      const doc = await db.settings.findOne('settings').exec();
      return doc ? doc.toJSON().new_cards_per_day : null;
    });
    expect(stored).toBe(25);
  });

  test('back button returns to deck list', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
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
      return doc?.toJSON()?.review_order === 'oldest-first';
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
  test.beforeEach(async ({ page }) => {
    await resetTestDB();
    await cloneTestRepo(page);
  });

  test('respects new cards per day setting', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const input = page.getByRole('spinbutton');
    await input.fill('2');
    await input.blur();

    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByText('spanish-vocab').click();

    // With limit of 2, should show "2 remaining" (only 2 new cards allowed)
    // 2 new cards × 1 direction = 2 (both new reversible, slots reserved atomically)
    await expect(page.getByText('2 remaining')).toBeVisible();
  });

  test('new cards per day = 0 shows session complete immediately', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const input = page.getByRole('spinbutton');
    await input.fill('0');
    await input.blur();

    // Wait for RxDB to persist the value
    await page.waitForFunction(async () => {
      const db = (window as any).__RXDB__;
      const doc = await db.settings.findOne('settings').exec();
      return doc?.toJSON()?.new_cards_per_day === 0;
    }, { timeout: 5000 });

    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByText('spanish-vocab').click();

    // No new cards allowed — should show session complete right away
    await expect(page.getByText('Session Complete')).toBeVisible();
    await expect(page.getByText('No more cards to review today.')).toBeVisible();
  });
});

