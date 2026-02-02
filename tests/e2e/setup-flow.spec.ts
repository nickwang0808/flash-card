import { test, expect } from '@playwright/test';

test.describe('Setup flow', () => {
  test('shows auth screen on first visit', async ({ page }) => {
    // Clear storage to simulate first visit
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByText('Flash Cards')).toBeVisible();
    await expect(page.getByPlaceholder(/github.com/i)).toBeVisible();
    await expect(page.getByPlaceholder(/ghp_/)).toBeVisible();
  });

  test('connect button is present', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByRole('button', { name: /connect/i })).toBeVisible();
  });
});
