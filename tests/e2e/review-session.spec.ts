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
    // Wait for remaining count to change after each rating (async RxDB write)
    for (let i = 6; i > 0; i--) {
      await expect(page.getByText(`${i} remaining`)).toBeVisible();
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    await expect(page.getByText('Session Complete')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('Done button returns to deck list', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Complete all cards
    for (let i = 6; i > 0; i--) {
      await expect(page.getByText(`${i} remaining`)).toBeVisible();
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('Undo button is not visible before rating a card', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('6 remaining')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).not.toBeVisible();
  });

  test('Undo reverts a card rated Again back to new', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('6 remaining')).toBeVisible();

    // Remember the front text of the first card
    const frontText = await page.locator('p.text-3xl').textContent();

    // Rate as Again — card stays in session but moves behind new items
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Again' }).click();

    // Still 6 remaining (Again keeps the card)
    await expect(page.getByText('6 remaining')).toBeVisible();

    // Rate the remaining 5 new cards as Easy to clear them out
    // Wait for remaining count to decrease after each (async RxDB write)
    for (let i = 6; i >= 2; i--) {
      await expect(page.getByText(`${i} remaining`)).toBeVisible();
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    // Now only the Again card remains — it should reappear
    await expect(page.getByText('1 remaining')).toBeVisible();
    await expect(page.locator('p.text-3xl')).toHaveText(frontText!);

    // Undo button should be visible since this card has a review log
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();

    // Card is still shown (undo reverts its FSRS state)
    await expect(page.locator('p.text-3xl')).toHaveText(frontText!);

    // Undo button should disappear since the log was removed
    await expect(page.getByRole('button', { name: 'Undo' })).not.toBeVisible();
  });
});
