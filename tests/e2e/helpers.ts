import { type Page } from '@playwright/test';

const TEST_CARDS = {
  hola: { id: 'hola', source: 'hola', translation: 'hello', example: 'Hola, ¿cómo estás?', notes: 'Common greeting', tags: ['greeting'], created: '2025-01-01T00:00:00Z' },
  gato: { id: 'gato', source: 'gato', translation: 'cat', example: 'El gato está durmiendo.', tags: ['animal'], created: '2025-01-01T00:00:00Z', reversible: true },
  perro: { id: 'perro', source: 'perro', translation: 'dog', tags: ['animal'], created: '2025-01-02T00:00:00Z' },
  casa: { id: 'casa', source: 'casa', translation: 'house', created: '2025-01-03T00:00:00Z' },
  agua: { id: 'agua', source: 'agua', translation: 'water', created: '2025-01-04T00:00:00Z' },
};

/**
 * Wipes all app data and reloads to show auth screen.
 */
export async function wipeAppData(page: Page) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Seeds a proper git repo with test cards into the browser's LightningFS
 * using the app's bundled window.__TEST__ helpers, then reloads.
 * After this, the page shows the deck list with "spanish-vocab".
 */
export async function seedTestData(page: Page) {
  // Load the app to get access to bundled modules
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => (window as any).__TEST__?.seedTestRepo, { timeout: 10000 });

  // Seed data (rmrf + git init + commit — no deleteDatabase)
  await page.evaluate(async (cards) => {
    localStorage.clear();
    localStorage.setItem('flash-card-wal', '{}'); // clear WAL
    await (window as any).__TEST__.seedTestRepo(cards);
    localStorage.setItem(
      'flash-card-settings',
      JSON.stringify({
        repoUrl: 'https://github.com/test/flashcards',
        token: 'fake-token',
        newCardsPerDay: 10,
        reviewOrder: 'random',
        theme: 'system',
      }),
    );
  }, TEST_CARDS);

  // Reload to get fresh app state reading from the newly seeded LightningFS
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=spanish-vocab', { timeout: 15000 });
}

/**
 * Reads the git log from the browser's LightningFS repo.
 */
export async function getGitLog(page: Page): Promise<Array<{ message: string; oid: string }>> {
  return page.evaluate(() => (window as any).__TEST__.getTestGitLog());
}

/**
 * Reads state.json for a deck from the browser's LightningFS repo.
 */
export async function getStateJson(page: Page, deckName: string): Promise<Record<string, any>> {
  return page.evaluate((deck: string) => (window as any).__TEST__.getTestStateJson(deck), deckName);
}
