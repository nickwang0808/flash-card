import postgres, { type Sql } from 'postgres';

let shared: Sql | undefined;

/**
 * One connection pool per function worker, reused across requests. The
 * connection string is a server-only secret and never reaches the client.
 */
export function getDb(databaseUrl: string): Sql {
  shared ??= postgres(databaseUrl, {
    max: 5,
    // Supabase transaction-pooler URLs carry sslmode=require; local URLs do not.
    ssl: databaseUrl.includes('sslmode=require') ? 'require' : false,
  });
  return shared;
}