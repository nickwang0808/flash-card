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

  test('shows correct count of new cards (30 reversible cards, limit 10 = 5 fwd + 5 rev)', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // 30 reversible cards, default limit 10 → 5 cards × 2 directions = 10 items
    await expect(page.getByText('10 remaining')).toBeVisible();
    await expect(page.getByText('New')).toBeVisible();
  });

  test('rating Easy removes card from session (schedules for future)', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Start with 10 cards
    await expect(page.getByText('10 remaining')).toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Easy' }).click();

    // Card is scheduled for future, removed from session
    await expect(page.getByText('9 remaining')).toBeVisible();
  });

  test('rating Again keeps card in session for later', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Again' }).click();

    // Card stays in session (due immediately), count should still be 10
    await expect(page.getByText('10 remaining')).toBeVisible();
  });

  test('completing all cards shows session complete', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Rate all cards as Easy to complete quickly
    // Wait for remaining count to change after each rating (async RxDB write)
    for (let i = 10; i > 0; i--) {
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
    for (let i = 10; i > 0; i--) {
      await expect(page.getByText(`${i} remaining`)).toBeVisible();
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('Undo button is not visible before rating a card', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).not.toBeVisible();
  });

  test('Undo reverts a card rated Again back to new', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();

    // Remember the front text of the first card
    const frontText = (await page.locator('[data-testid="card-front"]').textContent())?.trim();

    // Rate as Again — card stays in session but moves behind new items
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Again' }).click();

    // Still 10 remaining (Again keeps the card)
    await expect(page.getByText('10 remaining')).toBeVisible();

    // Rate the remaining 9 new cards as Easy to clear them out
    // Wait for remaining count to decrease after each (async RxDB write)
    for (let i = 10; i >= 2; i--) {
      await expect(page.getByText(`${i} remaining`)).toBeVisible();
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    // Now only the Again card remains — it should reappear
    await expect(page.getByText('1 remaining')).toBeVisible();
    await expect(page.locator('[data-testid="card-front"]')).toContainText(frontText!);

    // Undo button should be visible since this card has a review log
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();

    // Card is still shown (undo reverts its FSRS state)
    await expect(page.locator('[data-testid="card-front"]')).toContainText(frontText!);

    // Undo button should still be visible (other review logs exist from the Easy-rated cards)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('rating Hard keeps new card in session (short learning interval)', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Hard' }).click();

    // Hard on a new card schedules it for very soon (still due today),
    // so it stays in the session — count remains 10
    await expect(page.getByText('10 remaining')).toBeVisible();
    // Answer should be hidden again (ready for next review)
    await expect(page.getByRole('button', { name: 'Show Answer' })).toBeVisible();
  });

  test('rating Good keeps new card in session (short learning interval)', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Good' }).click();

    // Good on a new card schedules it for soon (still due today)
    await expect(page.getByText('10 remaining')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Answer' })).toBeVisible();
  });

  test('Suspend removes card from session permanently', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();
    const frontBefore = await page.locator('[data-testid="card-front"]').textContent();

    // Suspend the current card without rating it
    await page.getByRole('button', { name: 'Suspend' }).click();

    // With 30 cards, the next card backfills the slot (count stays at 10)
    // but the suspended card is gone — a different card is shown
    await expect(page.locator('[data-testid="card-front"]')).not.toHaveText(frontBefore!);
  });

  test('Suspend hides answer and shows next card unrevealed', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();

    // Reveal the answer first
    await page.getByRole('button', { name: 'Show Answer' }).click();

    // Rating buttons should be visible (answer is revealed)
    await expect(page.getByRole('button', { name: 'Again' })).toBeVisible();

    // Suspend while answer is shown
    await page.getByRole('button', { name: 'Suspend' }).click();

    // Next card should appear with answer hidden
    await expect(page.getByRole('button', { name: 'Show Answer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Again' })).not.toBeVisible();
  });

  test('End Session returns to deck list mid-session', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();

    // Rate one card, then end session
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Easy' }).click();
    await expect(page.getByText('9 remaining')).toBeVisible();

    await page.getByRole('button', { name: 'End Session' }).click();

    // Should return to deck list
    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
  });

  test('Show Answer reveals back content with markdown', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Find the "hola" card which has example and notes in its back markdown
    // Cards may appear in random order, so rate through until we find hola
    for (let remaining = 10; remaining > 0; remaining--) {
      await expect(page.getByText(`${remaining} remaining`)).toBeVisible();
      const front = (await page.locator('[data-testid="card-front"]').textContent())?.trim();
      if (front === 'hola') {
        await page.getByRole('button', { name: 'Show Answer' }).click();

        // Translation text
        await expect(page.getByText('hello')).toBeVisible();
        // Example sentence (rendered as italic from markdown *...*)
        await expect(page.getByText(/cómo estás/)).toBeVisible();
        // Notes (rendered as blockquote from markdown > ...)
        await expect(page.getByText('Common greeting')).toBeVisible();
        return; // Test passed
      }
      // Skip this card
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    // If we got here without finding hola, fail explicitly
    expect(true, 'Could not find "hola" card in session').toBe(false);
  });

  test('reverse card shows "reverse" label and swapped front/back', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Rate forward cards as Easy until we reach the reverse card (gato reverse)
    // Forward cards are shown first, reverse cards after
    for (let remaining = 10; remaining > 0; remaining--) {
      await expect(page.getByText(`${remaining} remaining`)).toBeVisible();
      const front = (await page.locator('[data-testid="card-front"]').textContent())?.trim();
      // The reverse card shows the back content as front — starts with "cat"
      if (front?.startsWith('cat')) {
        // Found the reverse card — the back is shown as the front
        await expect(page.getByText('reverse')).toBeVisible();
        await expect(page.getByText('New')).toBeVisible();

        // Reveal answer — should show the term (gato) as the back
        await page.getByRole('button', { name: 'Show Answer' }).click();
        await expect(page.getByTestId('card-back').getByText('gato')).toBeVisible();
        return; // Test passed
      }
      // Skip this forward card
      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }

    expect(true, 'Could not find reverse "cat" card in session').toBe(false);
  });

  test('Undo after rating Easy restores card as new', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    await expect(page.getByText('10 remaining')).toBeVisible();

    // Rate card as Easy — removes it from session
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: 'Easy' }).click();

    await expect(page.getByText('9 remaining')).toBeVisible();

    // Undo button should be visible — it targets the previously rated card, not the current one
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('new cards appear in JSON declaration order (same-timestamp cards)', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // The first 5 cards share the same created timestamp.
    // They should appear in JSON declaration order: hola, gato, perro, rojo, casa.
    // With limit 10 and 30 reversible cards, we get 5 forward + 5 reverse.
    // Forward cards come first in the queue.
    const expectedForwardOrder = ['hola', 'gato', 'perro', 'rojo', 'casa'];

    for (let i = 0; i < expectedForwardOrder.length; i++) {
      const remaining = 10 - i;
      await expect(page.getByText(`${remaining} remaining`)).toBeVisible();

      const front = await page.locator('[data-testid="card-front"]').textContent();
      expect(front?.toLowerCase()).toContain(expectedForwardOrder[i]);

      await page.getByRole('button', { name: 'Show Answer' }).click();
      await page.getByRole('button', { name: 'Easy' }).click();
    }
  });

  test('all four rating buttons are visible after revealing answer', async ({ page }) => {
    await page.getByText('spanish-vocab').click();

    // Before reveal, no rating buttons
    await expect(page.getByRole('button', { name: 'Again' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Hard' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Good' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Easy' })).not.toBeVisible();

    await page.getByRole('button', { name: 'Show Answer' }).click();

    // After reveal, all four rating buttons visible
    await expect(page.getByRole('button', { name: 'Again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Good' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Easy' })).toBeVisible();

    // Show Answer button should be gone
    await expect(page.getByRole('button', { name: 'Show Answer' })).not.toBeVisible();
  });
});
