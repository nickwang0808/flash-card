import { test, expect } from '@playwright/test';
import { wipeAppData, seedTestData } from './helpers';

test.describe('Setup flow', () => {
  test('shows auth screen on first visit', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await wipeAppData(page);

    await expect(page.getByRole('heading', { name: 'Flash Cards' })).toBeVisible();
    await expect(page.getByText('Git-backed spaced repetition')).toBeVisible();
    await expect(page.getByPlaceholder(/github.com/i)).toBeVisible();
    await expect(page.getByPlaceholder(/ghp_/)).toBeVisible();
    await expect(page.getByRole('button', { name: /connect/i })).toBeVisible();
  });

  test('shows deck list when already configured', async ({ page }) => {
    await seedTestData(page);

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
    await expect(page.getByText('spanish-vocab')).toBeVisible();
  });

  test('deck list shows correct card counts', async ({ page }) => {
    await seedTestData(page);

    // 5 cards + 1 reverse (gato) = 6 new, 0 due
    await expect(page.getByText('0 due')).toBeVisible();
    await expect(page.getByText('6 new')).toBeVisible();
  });

  test('deck list has sync and settings buttons', async ({ page }) => {
    await seedTestData(page);

    await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync Now' })).toBeVisible();
  });

  test('shows online status indicator', async ({ page }) => {
    await seedTestData(page);
    await expect(page.getByText('Online')).toBeVisible();
  });
});
