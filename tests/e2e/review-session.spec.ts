import { test, expect } from '@playwright/test';
import { cloneTestRepo, hasPendingReviewsVisible } from './helpers';

test.describe('Review session', () => {
  test.beforeEach(async ({ page }) => {
    await cloneTestRepo(page);
  });

  test('clicking a deck starts a review session', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByRole('button', { name: 'End Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Answer' })).toBeVisible();
    // Should show progress like "1 / 6"
    await expect(page.getByText(/1 \/ \d+/)).toBeVisible();
    // All cards are new
    await expect(page.getByText('New')).toBeVisible();
  });

  test('show answer reveals translation and rating buttons', async ({ page }) => {
    await page.getByText('spanish-vocab').click();
    await page.getByRole('button', { name: 'Show Answer' }).click();

    await expect(page.getByRole('button', { name: 'Again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Good' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Easy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Answer' })).not.toBeVisible();
  });

  test('rating a card advances to the next card', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText(/1 \/ \d+/)).toBeVisible();
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    await expect(page.getByText(/2 \/ \d+/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Answer' })).toBeVisible();
  });

  test('completing all cards shows session complete screen', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Review all 6 cards
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Good' }).click();
    }

    await expect(page.getByText('Session Complete')).toBeVisible();
    await expect(page.getByText(/Reviewed 6 cards/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'More New Cards' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('reverse cards show with reversed source/translation', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    let foundReverse = false;
    for (let i = 0; i < 6; i++) {
      // Wait for card to render
      await page.getByRole('button', { name: 'Show Answer' }).waitFor();
      const reverseLabel = page.locator('p.text-xs', { hasText: 'reverse' });
      if (await reverseLabel.isVisible().catch(() => false)) {
        foundReverse = true;
        await expect(page.locator('p.text-3xl')).toContainText('cat');
        await page.getByRole('button', { name: 'Show Answer' }).click();
        await expect(page.locator('p.text-xl')).toContainText('gato');
        break;
      }
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Good' }).click();
    }

    expect(foundReverse).toBe(true);
  });

  test('Done button returns to deck list with updated counts', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Good' }).click();
    }

    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
    await expect(page.getByText('0 new')).toBeVisible();
  });

  test('End Session button exits mid-session', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();
    await page.getByRole('button', { name: 'End Session' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('progress bar advances with each review', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    const bar = page.locator('.bg-primary.rounded-full.transition-all');
    const initialWidth = await bar.evaluate((el) => el.style.width);
    expect(initialWidth).toBe('0%');

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    const newWidth = await bar.evaluate((el) => el.style.width);
    expect(newWidth).not.toBe('0%');
  });
});
