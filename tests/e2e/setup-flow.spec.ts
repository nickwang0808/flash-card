import { test, expect } from '@playwright/test';
import { wipeAppData, cloneTestRepo, resetTestDB } from './helpers';

test.describe('Setup flow', () => {
  test.beforeEach(async () => {
    await resetTestDB();
  });

  test('shows auth screen on first visit', async ({ page }) => {
    await wipeAppData(page);

    await expect(page.getByText('Flash Cards')).toBeVisible();
    await expect(page.getByText('Spaced repetition with cloud sync')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with github/i })).toBeVisible();
  });

  test('connecting to test repo shows deck list', async ({ page }) => {
    await cloneTestRepo(page);

    await expect(page.getByText('Decks')).toBeVisible();
    await expect(page.getByText('spanish-vocab')).toBeVisible();
  });

  test('deck list shows correct card counts', async ({ page }) => {
    await cloneTestRepo(page);

    // 30 reversible cards, default limit 10 → 5 cards × 2 directions = 10 new, 0 due
    const spanishDeck = page.getByRole('button', { name: /spanish-vocab/ });
    await expect(spanishDeck.getByText('0 due')).toBeVisible();
    await expect(spanishDeck.getByText('10 new')).toBeVisible();
  });

  test('deck list has sync and settings buttons', async ({ page }) => {
    await cloneTestRepo(page);

    await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  });

  test('shows online status indicator', async ({ page }) => {
    await cloneTestRepo(page);
    await expect(page.getByText('Online')).toBeVisible();
  });
});
