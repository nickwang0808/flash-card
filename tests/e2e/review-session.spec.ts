import { test, expect } from '@playwright/test';
import { seedTestData, getGitLog, getStateJson } from './helpers';

test.describe('Review session', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestData(page);
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
    // Show Answer button should be gone
    await expect(page.getByRole('button', { name: 'Show Answer' })).not.toBeVisible();
  });

  test('rating a card advances to the next card', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Review first card
    await expect(page.getByText(/1 \/ \d+/)).toBeVisible();
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    // Should advance to card 2
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

  test('each rating creates a git commit with correct message format', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Review one card with Good
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    // Check the git log
    const log = await getGitLog(page);
    const reviewCommit = log[0];
    // Format: "review: <id> (Good) — next due <date>"
    expect(reviewCommit.message).toMatch(/^review: .+ \(Good\) — next due \d{4}-\d{2}-\d{2}$/);
  });

  test('all four ratings produce commits', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    const ratings = ['Good', 'Easy', 'Again', 'Hard'];
    for (const rating of ratings) {
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: rating }).click();
    }

    const log = await getGitLog(page);
    // 4 review commits + 1 seed commit = 5 total
    expect(log.length).toBeGreaterThanOrEqual(5);

    const reviewMessages = log.slice(0, 4).map((c) => c.message);
    expect(reviewMessages.some((m) => m.includes('(Good)'))).toBe(true);
    expect(reviewMessages.some((m) => m.includes('(Easy)'))).toBe(true);
    expect(reviewMessages.some((m) => m.includes('(Again)'))).toBe(true);
    expect(reviewMessages.some((m) => m.includes('(Hard)'))).toBe(true);
  });

  test('reviewing updates state.json with FSRS data', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Get the card name shown on screen
    const cardText = await page.locator('p.text-3xl').textContent();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    // Read state.json from the filesystem
    const state = await getStateJson(page, 'spanish-vocab');

    // Find the card's state entry
    const cardState = state[cardText!];
    expect(cardState).toBeDefined();
    expect(cardState.reps).toBe(1);
    expect(cardState.stability).toBeGreaterThan(0);
    expect(cardState.difficulty).toBeGreaterThan(0);
    expect(cardState.due).toBeDefined();
    expect(cardState.suspended).toBe(false);
  });

  test('reverse cards show with reversed source/translation', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Go through cards until we find the reverse card
    let foundReverse = false;
    for (let i = 0; i < 6; i++) {
      const reverseLabel = page.getByText('reverse');
      if (await reverseLabel.isVisible().catch(() => false)) {
        foundReverse = true;
        // Reverse card for "gato": source should be "cat", translation "gato"
        await expect(page.locator('p.text-3xl')).toContainText('cat');
        await page.getByRole('button', { name: 'Show Answer' }).click();
        await expect(page.getByText('gato')).toBeVisible();
        break;
      }
      // Skip this card
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Good' }).click();
    }

    expect(foundReverse).toBe(true);
  });

  test('reverse card commits use id:reverse format', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Go through cards until we find and rate the reverse card
    for (let i = 0; i < 6; i++) {
      const reverseLabel = page.getByText('reverse');
      if (await reverseLabel.isVisible().catch(() => false)) {
        await page.getByRole('button', { name: 'Show Answer' }).click();
        await page.getByRole('button', { name: 'Good' }).click();
        break;
      }
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Good' }).click();
    }

    const log = await getGitLog(page);
    const reverseCommit = log.find((c) => c.message.includes(':reverse'));
    expect(reverseCommit).toBeDefined();
    expect(reverseCommit!.message).toMatch(/review: gato:reverse \(\w+\)/);
  });

  test('Done button returns to deck list with updated counts', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Review all cards
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

    // Review one card then end
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();
    await page.getByRole('button', { name: 'End Session' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('progress bar advances with each review', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Initially the progress bar should be at 0%
    const bar = page.locator('.bg-primary.rounded-full.transition-all');
    const initialWidth = await bar.evaluate((el) => el.style.width);
    expect(initialWidth).toBe('0%');

    // Review one card
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    // Progress should have advanced
    const newWidth = await bar.evaluate((el) => el.style.width);
    expect(newWidth).not.toBe('0%');
  });
});
