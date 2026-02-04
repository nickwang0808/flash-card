import { test, expect } from '@playwright/test';
import { cloneTestRepo, createTestBranch, deleteTestBranch } from './helpers';

test.describe('Review session', () => {
  let testBranch: string;

  test.beforeEach(async ({ page }, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
    testBranch = await createTestBranch(`review-${safeName}`);
    await cloneTestRepo(page, testBranch);
  });

  test.afterEach(async () => {
    await deleteTestBranch(testBranch);
  });

  test('shows correct count of new cards (5 cards + 1 reversible = 6 new)', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // All 6 cards are new (5 regular + 1 reverse of gato)
    await expect(page.getByText('6 remaining')).toBeVisible();
    await expect(page.getByText('New')).toBeVisible();
  });

  test('rating Easy removes card from session (schedules for future)', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Start with 6 cards
    await expect(page.getByText('6 remaining')).toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Easy' }).click();

    // Card is scheduled for future, removed from session
    await expect(page.getByText('5 remaining')).toBeVisible();
  });

  test('rating Again keeps card in session for later', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('6 remaining')).toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Again' }).click();

    // Card stays in session (due immediately), count should still be 6
    await expect(page.getByText('6 remaining')).toBeVisible();
  });

  test('completing all cards shows session complete', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Rate all cards as Easy to complete quickly
    while (await page.getByRole('button', { name: 'Show Answer' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    await expect(page.getByText('Session Complete')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('Done button returns to deck list', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Complete all cards
    while (await page.getByRole('button', { name: 'Show Answer' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });
});
