import { execSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Local-stack credentials are never committed. Discovery order: explicit env
 * vars (CI or remote), then the running local stack via `supabase status -o env`.
 */
export function localStackEnv(): Record<string, string> {
  const fromProcess = (...keys: string[]): string | undefined => keys.map((k) => process.env[k]).find((v) => v !== undefined);

  const known = fromProcess('SUPABASE_URL');
  if (known) {
    return {
      SUPABASE_URL: process.env.SUPABASE_URL!,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
    };
  }

  const raw = execSync('npx supabase status -o env', { encoding: 'utf8' });
  const env: Record<string, string> = {};
  for (const match of raw.matchAll(/^(\w+)="(.*)"$/gm)) {
    env[match[1]] = match[2];
  }
  return {
    SUPABASE_URL: env.API_URL,
    SUPABASE_ANON_KEY: fromProcess('SUPABASE_ANON_KEY') ?? env.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_KEY: fromProcess('SUPABASE_SERVICE_KEY') ?? env.SECRET_KEY,
    DATABASE_URL: fromProcess('DATABASE_URL') ?? env.DB_URL,
  };
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export const TEST_PASSWORD = 'test-password-123';

/** Creates an email-confirmed user through the admin API; the caller deletes after. */
export async function createTestUser(client: SupabaseClient, email: string): Promise<TestUser> {
  const { data, error } = await client.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (!data.user || error) {
    throw new Error(`Failed to create test user ${email}: ${error?.message ?? 'unknown'}`);
  }
  return { id: data.user.id, email, password: TEST_PASSWORD };
}

export async function deleteTestUser(client: SupabaseClient, userId: string): Promise<void> {
  await client.auth.admin.deleteUser(userId);
}

/**
 * Deletes a user by email if one exists. Integration suites call this in
 * beforeAll so an aborted previous run cannot collide with the next run.
 */
export async function deleteUserByEmail(client: SupabaseClient, email: string): Promise<void> {
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const existing = data.users.find((user) => user.email === email);
  if (existing) {
    await client.auth.admin.deleteUser(existing.id);
  }
}