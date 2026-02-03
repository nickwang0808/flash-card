import { test, expect } from '@playwright/test';
import { seedTestData, wipeAppData, getGitLog } from './helpers';

test.describe('Sync screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestData(page);
  });

  test('navigates to sync screen and shows status', async ({ page }) => {
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Sync' })).toBeVisible();
    await expect(page.getByText('Online')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pull' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Push' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Push as Branch' })).toBeVisible();
  });

  test('shows recent commits in git log', async ({ page }) => {
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    await expect(page.getByText('Recent Commits')).toBeVisible();
    await expect(page.getByText('seed test data')).toBeVisible();
  });

  test('shows review commits after a session', async ({ page }) => {
    // Do a review first
    await page.getByText('spanish-vocab').click();
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();
    await page.getByRole('button', { name: 'End Session' }).click();

    // Go to sync
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    // Should see the review commit
    await expect(page.getByText(/review: .+ \(Good\)/)).toBeVisible();
  });

  test('back button returns to deck list', async ({ page }) => {
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });
});

test.describe('Settings screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestData(page);
  });

  test('navigates to settings and shows current config', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('https://github.com/test/flashcards')).toBeVisible();
    await expect(page.getByText(/New cards per day: 10/)).toBeVisible();
  });

  test('has review order dropdown with options', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const select = page.getByRole('combobox');
    await expect(select).toBeVisible();

    // Check options exist
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

    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(hasDarkClass).toBe(true);
  });

  test('switching to light theme removes dark class', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'dark' }).click();
    await page.getByRole('button', { name: 'light' }).click();

    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(hasDarkClass).toBe(false);
  });

  test('new cards per day slider persists value', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const slider = page.getByRole('slider');
    await slider.fill('5');

    // Verify it's reflected in the label
    await expect(page.getByText(/New cards per day: 5/)).toBeVisible();

    // Verify it persisted to localStorage
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('flash-card-settings');
      return raw ? JSON.parse(raw).newCardsPerDay : null;
    });
    expect(stored).toBe(5);
  });

  test('back button returns to deck list', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('logout clears all data and returns to auth screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    // Accept the confirm dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Logout' }).click();

    await expect(page.getByRole('heading', { name: 'Flash Cards' })).toBeVisible();
    await expect(page.getByPlaceholder(/github.com/i)).toBeVisible();

    // Verify localStorage is cleared
    const hasSettings = await page.evaluate(() =>
      localStorage.getItem('flash-card-settings'),
    );
    expect(hasSettings).toBeNull();
  });
});

test.describe('New card daily limit', () => {
  test('respects new cards per day setting', async ({ page }) => {
    await seedTestData(page);

    // Set limit to 2
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('slider').fill('2');
    await page.getByRole('button', { name: 'Back' }).click();

    // Start review
    await page.getByText('spanish-vocab').click();

    // Should only have 2 cards (the new card limit)
    await expect(page.getByText(/1 \/ 2/)).toBeVisible();
  });
});
