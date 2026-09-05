import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestUser, deleteUserByEmail, deleteTestUser, localStackEnv, TEST_PASSWORD } from '../../../supabase/migrations/local-stack.test-support.ts';

/**
 * End-to-end smoke against the ACTUAL local Edge Function. Requires
 * `supabase functions serve api` to be running (the local stack must be up).
 * Uses a real email/password sign-in token and raw HTTP tRPC calls.
 */
const env = localStackEnv();
const FUNCTION_URL = `${env.SUPABASE_URL}/functions/v1/api`;
const EMAIL = 'smoke-test@example.com';

let admin: SupabaseClient;
let userId: string;
let accessToken: string;

async function trpcMutation<T>(path: string, input: unknown, token: string): Promise<T> {
  const response = await fetch(`${FUNCTION_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  return trpcResult<T>(path, response);
}

async function trpcQuery<T>(path: string, input: unknown, token: string): Promise<T> {
  const response = await fetch(
    `${FUNCTION_URL}/${path}?input=${encodeURIComponent(JSON.stringify(input ?? {}))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return trpcResult<T>(path, response);
}

async function trpcResult<T>(path: string, response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const body = (await response.json()) as { result?: { data?: T }; error?: unknown };
  if (body.error) {
    throw new Error(`${path} error: ${JSON.stringify(body.error).slice(0, 300)}`);
  }
  return body.result!.data!;
}

beforeAll(async () => {
  admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  await deleteUserByEmail(admin, EMAIL);
  const user = await createTestUser(admin, EMAIL);
  userId = user.id;

  const { data, error } = await createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email: EMAIL, password: TEST_PASSWORD });
  if (error || !data.session) {
    throw new Error(`Sign-in failed: ${error?.message ?? 'no session'}`);
  }
  accessToken = data.session.access_token;
});

afterAll(async () => {
  await deleteTestUser(admin, userId);
});

describe('local Edge Function HTTP smoke', () => {
  it('auth.session confirms the verified identity', async () => {
    const session = await trpcQuery<{ userId: string; email: string | null }>('auth.session', {}, accessToken);
    expect(session.userId).toBe(userId);
    expect(session.email).toBe(EMAIL);
  });

  it('rejects an invalid token with 401', async () => {
    const response = await fetch(`${FUNCTION_URL}/deck.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it('creates a deck, a card, queues, rates, history, and undo end to end', async () => {
    const deck = await trpcMutation<{ id: string }>(
      'deck.create',
      { name: 'Smoke Spanish', defaultSpeechLocale: 'es' },
      accessToken,
    );

    const card = await trpcMutation<{ id: string; version: number }>(
      'card.create',
      {
        deckId: deck.id,
        name: 'Hola',
        frontMarkdown: 'Hello',
        backMarkdown: 'Hola',
        speechText: 'hola',
        speechLocale: 'es',
        tags: ['greeting'],
      },
      accessToken,
    );
    expect(card.version).toBe(0);

    const queue = await trpcQuery<{ items: { id: string; status: string }[] }>(
      'deck.queue',
      { deckId: deck.id, horizonHours: 48, limit: 50 },
      accessToken,
    );
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].id).toBe(card.id);
    expect(queue.items[0].status).toBe('new');

    const rated = await trpcMutation<{ reviewId: string; queue: { items: { status: string }[] } }>(
      'review.rate',
      {
        cardId: card.id,
        deckId: deck.id,
        rating: 'good',
        expectedVersion: 0,
        requestId: '00000000-0000-4000-8000-0000000000c1',
        queue: { horizonHours: 48, limit: 50 },
      },
      accessToken,
    );
    expect(rated.reviewId).toMatch(/^[0-9a-f-]{36}$/);
    // The rated card becomes future within the same horizon.
    expect(rated.queue.items).toHaveLength(1);
    expect(rated.queue.items[0].status).not.toBe('new');

    const history = await trpcQuery<{ events: { id: string; rating: string; undoneAt: string | null }[] }>(
      'review.history',
      { cardId: card.id, deckId: deck.id, pagination: { limit: 10 } },
      accessToken,
    );
    expect(history.events).toHaveLength(1);
    expect(history.events[0].rating).toBe('good');
    expect(history.events[0].undoneAt).toBeNull();

    const undone = await trpcMutation<{ queue: { items: { status: string }[] } }>(
      'review.undo',
      { reviewId: rated.reviewId, deckId: deck.id, queue: { horizonHours: 48, limit: 50 } },
      accessToken,
    );
    expect(undone.queue.items[0].status).toBe('new');

    const afterUndo = await trpcQuery<{ events: { undoneAt: string | null }[] }>(
      'review.history',
      { cardId: card.id, deckId: deck.id, pagination: { limit: 10 } },
      accessToken,
    );
    expect(afterUndo.events[0].undoneAt).not.toBeNull();
  });
});