import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getDb, type AppDbWithPool } from '../../../../src/db/client.ts';
import { appRouter } from '../router.ts';
import type { ApiContext } from '../trpc.ts';
import { createTestUser, deleteTestUser, deleteUserByEmail, localStackEnv } from '../../../migrations/local-stack.test-support.ts';

export async function createCallerFixture(label: string) {
  const env = localStackEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const email = `${label}-${Date.now()}@example.com`;
  await deleteUserByEmail(admin, email);
  const user = await createTestUser(admin, email);
  const db = getDb(env.DATABASE_URL);
  const identity = { userId: user.id, email: user.email, issuedAt: null, expiresAt: null };
  const context: ApiContext = { identity, db };
  return { admin, db, userId: user.id, caller: appRouter.createCaller(context) };
}
export async function destroyCallerFixture(fixture: { admin: SupabaseClient; db: AppDbWithPool; userId: string }): Promise<void> {
  await deleteTestUser(fixture.admin, fixture.userId);
  await fixture.db.$client.end();
}
