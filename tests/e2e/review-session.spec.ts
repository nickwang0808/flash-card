import { test, expect } from '@playwright/test';
import { cloneTestRepo, createTestBranch, deleteTestBranch } from './helpers';

test.describe('Review session', () => {
  let testBranch: string;

  test.beforeEach(async ({ page }, testInfo) => {
    // Create a fresh branch for each test
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
    testBranch = await createTestBranch(`review-${safeName}`);
    await cloneTestRepo(page, testBranch);
  });

  test.afterEach(async () => {
    await deleteTestBranch(testBranch);
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

    // Review all available cards (loop until session complete)
    while (await page.getByRole('button', { name: 'Show Answer' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Good' }).click();
    }

    await expect(page.getByText('Session Complete')).toBeVisible();
    await expect(page.getByText(/Reviewed \d+ cards/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'More New Cards' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('reverse cards show with reversed source/translation', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    let foundReverse = false;
    // Loop through available cards looking for a reverse card
    while (await page.getByRole('button', { name: 'Show Answer' }).isVisible().catch(() => false)) {
      const reverseLabel = page.locator('p.text-xs', { hasText: 'reverse' });
      if (await reverseLabel.isVisible().catch(() => false)) {
        foundReverse = true;
        // The reverse card shows the translation (cat) as the question
        await expect(page.locator('p.text-3xl')).toContainText('cat');
        await page.getByRole('button', { name: 'Show Answer' }).click();
        // And the source (gato) as the answer
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

    // Review all available cards
    while (await page.getByRole('button', { name: 'Show Answer' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Good' }).click();
    }

    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
    // After reviewing all cards, new count should decrease (may be 0 or very low)
    await expect(page.locator('text=/\\d+ new/')).toBeVisible();
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

    // Wait for review screen to load (Show Answer button appears)
    await page.getByRole('button', { name: 'Show Answer' }).waitFor();

    // Check the progress counter shows 1 / N
    await expect(page.getByText(/1 \/ \d+/)).toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    // After rating, counter should advance to 2 / N
    await expect(page.getByText(/2 \/ \d+/)).toBeVisible();
  });
});
