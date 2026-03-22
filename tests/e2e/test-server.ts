/**
 * E2E test setup: seeds the local Supabase instance with test data.
 * Replaces the old git repo + HTTP mock server approach.
 *
 * Requires local Supabase to be running (`npx supabase start`).
 */
import { execSync } from 'child_process';

export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Dev test user credentials (matches useAuth.devSignIn)
export const TEST_USER_EMAIL = 'e2e@localhost';
export const TEST_USER_PASSWORD = 'e2e-test-password';

export const TEST_CARDS: Record<string, {
  front?: string;
  back: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
  approved?: boolean;
}> = {
  hola: { back: 'hello\n\n*Hola, ¿cómo estás?*\n\n> Common greeting', tags: ['greeting'], created: '2025-01-01T00:00:00Z', reversible: true },
  gato: { back: '# cat\n\n*El gato está durmiendo.*', tags: ['animal'], created: '2025-01-01T00:00:00Z', reversible: true },
  perro: { back: 'dog', tags: ['animal'], created: '2025-01-01T00:00:00Z', reversible: true },
  rojo: { back: 'red', tags: ['color'], created: '2025-01-01T00:00:00Z', reversible: true },
  casa: { back: 'house', created: '2025-01-01T00:00:00Z', reversible: true },
  agua: { back: 'water', created: '2025-01-04T00:00:00Z', reversible: true },
  libro: { back: 'book', created: '2025-01-05T00:00:00Z', reversible: true },
  amigo: { back: 'friend', created: '2025-01-06T00:00:00Z', reversible: true },
  comida: { back: 'food', created: '2025-01-07T00:00:00Z', reversible: true },
  ciudad: { back: 'city', created: '2025-01-08T00:00:00Z', reversible: true },
  tiempo: { back: 'time', created: '2025-01-09T00:00:00Z', reversible: true },
  familia: { back: 'family', created: '2025-01-10T00:00:00Z', reversible: true },
  grande: { back: 'big', created: '2025-01-11T00:00:00Z', reversible: true },
  verde: { back: 'green', created: '2025-01-12T00:00:00Z', reversible: true },
  blanco: { back: 'white', created: '2025-01-13T00:00:00Z', reversible: true },
  comer: { back: 'to eat', created: '2025-01-14T00:00:00Z', reversible: true },
  dormir: { back: 'to sleep', created: '2025-01-15T00:00:00Z', reversible: true },
  correr: { back: 'to run', created: '2025-01-16T00:00:00Z', reversible: true },
  hablar: { back: 'to speak', created: '2025-01-17T00:00:00Z', reversible: true },
  vivir: { back: 'to live', created: '2025-01-18T00:00:00Z', reversible: true },
  trabajo: { back: 'work', created: '2025-01-19T00:00:00Z', reversible: true },
  escuela: { back: 'school', created: '2025-01-20T00:00:00Z', reversible: true },
  hermano: { back: 'brother', created: '2025-01-21T00:00:00Z', reversible: true },
  madre: { back: 'mother', created: '2025-01-22T00:00:00Z', reversible: true },
  padre: { back: 'father', created: '2025-01-23T00:00:00Z', reversible: true },
  noche: { back: 'night', created: '2025-01-24T00:00:00Z', reversible: true },
  'mañana': { back: 'morning', created: '2025-01-25T00:00:00Z', reversible: true },
  dinero: { back: 'money', created: '2025-01-26T00:00:00Z', reversible: true },
  puerta: { back: 'door', created: '2025-01-27T00:00:00Z', reversible: true },
  ventana: { back: 'window', created: '2025-01-28T00:00:00Z', reversible: true },
  // AI-generated cards (unapproved)
  bailar: { back: 'to dance', created: '2025-01-29T00:00:00Z', reversible: true, approved: false },
  cantar: { back: 'to sing', created: '2025-01-29T00:00:00Z', reversible: true, approved: false },
  leer: { back: 'to read', created: '2025-01-29T00:00:00Z', reversible: true, approved: false },
};

export const CHINESE_TEST_CARDS: Record<string, {
  front: string;
  back: string;
  created: string;
  reversible?: boolean;
}> = {
  '上午': { front: '<ruby>上<rt>shàng</rt></ruby><ruby>午<rt>wǔ</rt></ruby>', back: 'morning', created: '2025-02-01T00:00:00Z', reversible: false },
  '你好': { front: '<ruby>你<rt>nǐ</rt></ruby><ruby>好<rt>hǎo</rt></ruby>', back: 'hello', created: '2025-02-01T00:00:00Z', reversible: false },
};

let testUserId: string | null = null;

/** Get the anon key from `supabase status` output */
function getAnonKey(): string {
  if (SUPABASE_ANON_KEY) return SUPABASE_ANON_KEY;
  const output = execSync('npx supabase status -o env', { encoding: 'utf-8' });
  const match = output.match(/ANON_KEY="([^"]+)"/);
  if (!match) throw new Error('Could not find anon key from supabase status');
  return match[1];
}

/** Create (or sign in) a test user and return the user ID + access token */
async function getOrCreateTestUser(): Promise<{ userId: string; accessToken: string }> {
  const anonKey = getAnonKey();

  // Try sign in first
  let res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
  });

  if (!res.ok) {
    // Sign up
    res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
    });
    if (!res.ok) throw new Error(`Failed to create test user: ${await res.text()}`);
  }

  const data = await res.json();
  return {
    userId: data.user?.id || data.id,
    accessToken: data.access_token,
  };
}

/** Delete all data for the test user (cards, srs_state, review_logs, settings) */
async function clearTestUserData(userId: string, accessToken: string): Promise<void> {
  const anonKey = getAnonKey();
  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  // Delete in FK-safe order
  for (const table of ['card_snapshots', 'review_logs', 'srs_state', 'cards', 'settings']) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?userId=eq.${userId}`, {
      method: 'DELETE',
      headers,
    });
  }
}

/** Seed test cards into Supabase for the given user */
async function seedTestCards(userId: string, accessToken: string): Promise<void> {
  const anonKey = getAnonKey();
  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    Prefer: 'return=minimal',
  };

  const spanishRows = Object.entries(TEST_CARDS).map(([term, card], index) => ({
    userId: userId,
    deckName: 'spanish-vocab',
    term,
    front: card.front ?? null,
    back: card.back,
    tags: JSON.stringify(card.tags ?? []),
    created: card.created,
    reversible: card.reversible ?? false,
    order: index,
    suspended: false,
    approved: card.approved ?? true,
    _deleted: false,
  }));

  const chineseRows = Object.entries(CHINESE_TEST_CARDS).map(([term, card], index) => ({
    userId: userId,
    deckName: 'chinese-vocab',
    term,
    front: card.front,
    back: card.back,
    tags: JSON.stringify([]),
    created: card.created,
    reversible: card.reversible ?? false,
    order: index,
    suspended: false,
    approved: true,
    _deleted: false,
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/cards`, {
    method: 'POST',
    headers,
    body: JSON.stringify([...spanishRows, ...chineseRows]),
  });

  if (!res.ok) {
    throw new Error(`Failed to seed cards: ${await res.text()}`);
  }

  // Re-create default settings (the auto-create trigger only fires on user signup)
  const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({
      userId,
      newCardsPerDay: 10,
      reviewOrder: 'random',
      theme: 'system',
      _deleted: false,
    }),
  });

  if (!settingsRes.ok) {
    throw new Error(`Failed to seed settings: ${await settingsRes.text()}`);
  }
}

/** Full setup: create user, clear data, seed cards */
export async function setupTestData(): Promise<void> {
  const { userId, accessToken } = await getOrCreateTestUser();
  testUserId = userId;
  await clearTestUserData(userId, accessToken);
  await seedTestCards(userId, accessToken);
}

/** Reset data between tests: clear and re-seed */
export async function resetTestData(): Promise<void> {
  const { userId, accessToken } = await getOrCreateTestUser();
  testUserId = userId;
  await clearTestUserData(userId, accessToken);
  await seedTestCards(userId, accessToken);
}

/** Clean up: clear all test user data */
export async function cleanupTestData(): Promise<void> {
  try {
    const { userId, accessToken } = await getOrCreateTestUser();
    await clearTestUserData(userId, accessToken);
  } catch {
    // Best effort
  }
}

export function getTestUserId(): string {
  if (!testUserId) throw new Error('Test user not set up. Call setupTestData() first.');
  return testUserId;
}
