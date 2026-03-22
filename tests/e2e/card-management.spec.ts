import { test, expect } from '@playwright/test';
import { cloneTestRepo, resetTestDB } from './helpers';

/** Navigate to card list for a deck (auth must be set up already) */
async function goToCardList(page: import('@playwright/test').Page, deckName: string) {
  await page.goto(`/cards/${deckName}`);
  await page.waitForSelector('[data-testid="card-search"]', { timeout: 15000 });
}

test.describe('Card management', () => {
  test.beforeEach(async ({ page }) => {
    await resetTestDB();
    await cloneTestRepo(page);
  });

  test('card list shows all cards for the deck', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    // 30 approved + 3 unapproved = 33 total (none suspended)
    const cardRows = page.getByTestId('card-row');
    await expect(cardRows.first()).toBeVisible();
    const count = await cardRows.count();
    expect(count).toBe(33);
  });

  test('card list shows pending count for unapproved cards', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await expect(page.getByText('Approve 3')).toBeVisible();
  });

  test('search filters cards by term', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('hola');

    const cardRows = page.getByTestId('card-row');
    await expect(cardRows).toHaveCount(1);
    await expect(cardRows.first()).toContainText('hola');
  });

  test('search filters cards by back content', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('cat');

    const cardRows = page.getByTestId('card-row');
    await expect(cardRows).toHaveCount(1);
    await expect(cardRows.first()).toContainText('gato');
  });

  test('search shows empty state when no matches', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('zzzznotacard');

    await expect(page.getByText('No cards match your search.')).toBeVisible();
  });

  test('pending cards show "pending" tag', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('bailar');

    const cardRow = page.getByTestId('card-row').first();
    await expect(cardRow).toContainText('pending');
  });

  test('tapping a card navigates to edit view', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('hola');
    await page.getByTestId('card-row').first().click();

    await expect(page.getByTestId('edit-term')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('edit-term')).toHaveValue('hola');
  });

  test('edit view loads card data correctly', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('gato');
    await page.getByTestId('card-row').first().click();

    await expect(page.getByTestId('edit-term')).toHaveValue('gato');
    await expect(page.getByTestId('edit-back')).toContainText('cat');
  });

  test('edit view saves changes to card', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('hola');
    await page.getByTestId('card-row').first().click();

    await expect(page.getByTestId('edit-term')).toBeVisible({ timeout: 5000 });

    // Change the back content
    await page.getByTestId('edit-back').fill('hello (updated)');
    await page.getByTestId('save-button').click();

    // Should navigate back to card list
    await expect(page.getByTestId('card-search')).toBeVisible({ timeout: 5000 });

    // Verify the change persisted
    await page.getByTestId('card-search').fill('hola');
    await expect(page.getByTestId('card-row').first()).toContainText('hello (updated)');
  });

  test('edit view shows approval status for approved card', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('hola');
    await page.getByTestId('card-row').first().click();
    await expect(page.getByText('Approved')).toBeVisible({ timeout: 5000 });
  });

  test('edit view shows pending status for unapproved card', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByTestId('card-search').fill('bailar');
    await page.getByTestId('card-row').first().click();
    await expect(page.getByText('Pending approval')).toBeVisible({ timeout: 5000 });
  });

  test('approve button navigates to approval view', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');

    await page.getByText('Approve 3').click();

    await expect(page.getByText('3 remaining')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('swipe-card')).toBeVisible();
  });

  test('approval view shows unapproved card content', async ({ page }) => {
    await goToCardList(page, 'spanish-vocab');
    await page.getByText('Approve 3').click();
    await expect(page.getByTestId('swipe-card')).toBeVisible({ timeout: 5000 });

    // Should show one of the unapproved cards
    const cardText = await page.getByTestId('swipe-card').textContent();
    const hasUnapproved =
      cardText?.includes('bailar') ||
      cardText?.includes('cantar') ||
      cardText?.includes('leer');
    expect(hasUnapproved).toBe(true);
  });

  test('approval view shows "All Done" when no pending cards', async ({ page }) => {
    // Approve all cards via RxDB
    await page.evaluate(async () => {
      const db = (window as any).__RXDB__;
      const cards = await db.cards.find({ selector: { approved: false } }).exec();
      for (const card of cards) {
        await card.incrementalPatch({ approved: true });
      }
    });

    await page.goto('/cards/approve/spanish-vocab');
    await expect(page.getByText('All Done')).toBeVisible({ timeout: 10000 });
  });
});
