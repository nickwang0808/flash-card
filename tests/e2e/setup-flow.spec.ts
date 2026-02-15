import { test, expect } from '@playwright/test';
import { wipeAppData, cloneTestRepo, createTestBranch, deleteTestBranch } from './helpers';

test.describe('Setup flow', () => {
  let testBranch: string;

  test.beforeEach(async ({}, testInfo) => {
    // Create a fresh branch for each test
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
    testBranch = await createTestBranch(`setup-${safeName}`);
  });

  test.afterEach(async () => {
    await deleteTestBranch(testBranch);
  });

  test('shows auth screen on first visit', async ({ page }) => {
    await wipeAppData(page);

    await expect(page.getByRole('heading', { name: 'Flash Cards' })).toBeVisible();
    await expect(page.getByText('Git-backed spaced repetition')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with github/i })).toBeVisible();
  });

  test('connecting to test repo shows deck list', async ({ page }) => {
    await cloneTestRepo(page, testBranch);

    await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible();
    await expect(page.getByText('spanish-vocab')).toBeVisible();
  });

  test('deck list shows correct card counts', async ({ page }) => {
    await cloneTestRepo(page, testBranch);

    // 30 cards, 2 reversible (gato, rojo), default limit 10 = 10 new, 0 due
    await expect(page.getByText('0 due')).toBeVisible();
    await expect(page.getByText('10 new')).toBeVisible();
  });

  test('deck list has sync and settings buttons', async ({ page }) => {
    await cloneTestRepo(page, testBranch);

    await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  });

  test('shows online status indicator', async ({ page }) => {
    await cloneTestRepo(page, testBranch);
    await expect(page.getByText('Online')).toBeVisible();
  });
});
