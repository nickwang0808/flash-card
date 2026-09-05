import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AcceptanceApiClient } from './api-client.ts';
import { TestClock } from './clock.ts';
import { acceptanceEnv, adminClient, anonymousClient } from './environment.ts';

const TEST_PASSWORD = 'acceptance-test-password-123';

export interface TestActor {
  userId: string;
  email: string;
  accessToken: string;
  api: AcceptanceApiClient;
  clock: TestClock;
  admin: SupabaseClient;
}

export async function createActor(label: string, initialTime = '2026-01-01T12:00:00.000Z'): Promise<TestActor> {
  const admin = adminClient();
  const email = `acceptance-${acceptanceEnv.runId}-${label}-${randomUUID()}@example.com`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (createError || !created.user) throw new Error(`Creating actor failed: ${createError?.message ?? 'no user'}`);

  const { data: signedIn, error: signInError } = await anonymousClient().auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signInError || !signedIn.session) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(`Signing in actor failed: ${signInError?.message ?? 'no session'}`);
  }

  const clock = new TestClock(initialTime);
  return { userId: created.user.id, email, accessToken: signedIn.session.access_token, api: new AcceptanceApiClient(signedIn.session.access_token, clock), clock, admin };
}

export async function destroyActor(actor: TestActor | undefined): Promise<void> {
  if (!actor) return;
  const { error } = await actor.admin.auth.admin.deleteUser(actor.userId);
  if (error && !/not found/i.test(error.message)) throw error;
}
