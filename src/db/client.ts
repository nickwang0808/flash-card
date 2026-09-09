import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/** The typed database over the full schema. Queries share one underlying postgres pool. */
export type AppDb = PostgresJsDatabase<typeof schema>;

/**
 * The typed database plus the underlying postgres pool, so callers can end it.
 * `getDb()` returns this intersection; the pool is exposed as `$client`.
 */
export type AppDbWithPool = AppDb & { $client: postgres.Sql };

/**
 * A transaction handle. PgTransaction extends the PgDatabase surface, so the
 * same AppDb shape is usable inside `db.transaction(cb)`.
 */
export type DbTransaction = AppDb;

let shared: { databaseUrl: string; db: AppDbWithPool } | undefined;

/** Returns one production pool per Edge Function worker and database URL. */
export function getDb(databaseUrl: string): AppDbWithPool {
  if (shared?.databaseUrl === databaseUrl) return shared.db;
  const pool = postgres(databaseUrl, {
    max: 5,
    // Transaction pooling cannot retain prepared statements between requests.
    prepare: false,
    // Supabase pooler URLs carry sslmode=require; local URLs do not.
    ssl: databaseUrl.includes('sslmode=require') ? 'require' : false,
  });
  const db = drizzle(pool, { schema }) as AppDbWithPool;
  Object.defineProperty(db, '$client', { value: pool, enumerable: true });
  shared = { databaseUrl, db };
  return db;
}