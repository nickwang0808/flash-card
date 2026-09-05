import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the acceptance runner`);
  return value;
}

export const acceptanceEnv = Object.freeze({
  supabaseUrl: required('SUPABASE_URL'),
  anonKey: required('SUPABASE_ANON_KEY'),
  serviceKey: required('SUPABASE_SERVICE_KEY'),
  databaseUrl: required('DATABASE_URL'),
  clockSecret: required('FLASHCARD_TEST_CLOCK_SECRET'),
  runId: required('FLASHCARD_ACCEPTANCE_RUN_ID'),
});

export const functionUrl = `${acceptanceEnv.supabaseUrl}/functions/v1/api`;

export function adminClient(): SupabaseClient {
  return createClient(acceptanceEnv.supabaseUrl, acceptanceEnv.serviceKey, { auth: { persistSession: false } });
}

export function anonymousClient(): SupabaseClient {
  return createClient(acceptanceEnv.supabaseUrl, acceptanceEnv.anonKey, { auth: { persistSession: false } });
}
