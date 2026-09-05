import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deleteUserByEmail, localStackEnv } from './local-stack.test-support.ts';
const env = localStackEnv();

const emailA = 'schema-test-a@example.com';
const emailB = 'schema-test-b@example.com';
const password = 'test-password-123';

let admin: SupabaseClient;
let anon: SupabaseClient;
let userIdA: string;
let userIdB: string;

beforeAll(async () => {
  admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  await deleteUserByEmail(admin, emailA);
  await deleteUserByEmail(admin, emailB);
  const createdA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  const createdB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (!createdA.data.user || !createdB.data.user) {
    throw new Error(`Failed to create test users: ${createdA.error?.message ?? ''} ${createdB.error?.message ?? ''}`);
  }
  userIdA = createdA.data.user.id;
  userIdB = createdB.data.user.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(userIdA);
  await admin.auth.admin.deleteUser(userIdB);
});

const newCardInsert = (deckId: string) => ({
  deck_id: deckId,
  name: 'Sample card',
  front_markdown: 'front',
  back_markdown: 'back',
});

describe('authoritative schema contracts', () => {
  it('creates the four authoritative tables', async () => {
    for (const table of ['decks', 'cards', 'review_events', 'card_revisions'] as const) {
      const { error } = await admin.from(table).select('id').limit(1);
      expect(error, `${table} should exist`).toBeNull();
    }
  });

  it('enforces per-user deck name uniqueness', async () => {
    const { error: first } = await admin.from('decks').insert({ user_id: userIdA, name: 'Spanish' });
    expect(first).toBeNull();

    const { error: duplicate } = await admin.from('decks').insert({ user_id: userIdA, name: 'Spanish' });
    expect(duplicate).not.toBeNull();

    const { error: otherUser } = await admin.from('decks').insert({ user_id: userIdB, name: 'Spanish' });
    expect(otherUser).toBeNull();
  });

  it('rejects a blank card name', async () => {
    const { data: deck } = await admin.from('decks').select('id').eq('user_id', userIdA).single();
    const { error } = await admin.from('cards').insert({ ...newCardInsert(deck!.id), name: '   ' });
    expect(error).not.toBeNull();
  });

  it('rejects partially populated cadence state', async () => {
    const { data: deck } = await admin.from('decks').select('id').eq('user_id', userIdA).single();
    const { error } = await admin.from('cards').insert({
      ...newCardInsert(deck!.id),
      cadence_phase: 'review',
      next_review_at: new Date().toISOString(),
      scheduler_version: 1,
      // interval_days intentionally missing
    });
    expect(error).not.toBeNull();
  });

  it('enforces the request_id idempotency key on review events', async () => {
    const { data: deck } = await admin.from('decks').select('id').eq('user_id', userIdA).single();
    const { data: card } = await admin.from('cards').insert(newCardInsert(deck!.id)).select().single();

    const event = {
      card_id: card!.id,
      rating: 'good',
      reviewed_at: new Date().toISOString(),
      after_state: JSON.stringify({
        cadence_phase: 'review',
        next_review_at: new Date(Date.now() + 86_400_000).toISOString(),
        interval_days: 1,
        review_count: 1,
        lapse_count: 0,
        scheduler_version: 1,
      }),
      request_id: '00000000-0000-4000-8000-000000000001',
    };

    const { error: first } = await admin.from('review_events').insert(event);
    expect(first).toBeNull();

    const { error: replay } = await admin.from('review_events').insert(event);
    expect(replay).not.toBeNull();

    const { error: badRating } = await admin.from('review_events').insert({ ...event, rating: 'meh' });
    expect(badRating).not.toBeNull();
  });

  it('denies anonymous access through RLS', async () => {
    const { data, error } = await anon.from('decks').select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { error: insertError } = await anon.from('decks').insert({ user_id: userIdA, name: 'Sneaky' });
    expect(insertError).not.toBeNull();
  });
});