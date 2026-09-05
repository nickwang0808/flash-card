import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/** The typed database over the full schema. Queries share one underlying postgres pool. */
export type AppDb = PostgresJsDatabase<typeof schema>;

/**
 * The typed database plus the underlying postgres pool, so callers can end it.
 * `getDb()` returns this intersection; the pool is exposed as `$client`.
 */
export type AppDbWithPool = AppDb & { $client: ReturnType<typeof postgres> };

/**
 * A transaction handle. PgTransaction extends the PgDatabase surface, so the
 * same AppDb shape is usable inside `db.transaction(cb)`.
 */
export type DbTransaction = AppDb;

let shared: AppDb | undefined;

/**
 * One Drizzle pool per function worker, reused across requests. The
 * connection string is a server-only secret and never reaches the client.
 */
export function getDb(databaseUrl: string): AppDbWithPool {
  const pool = postgres(databaseUrl, {
    max: 5,
    // Supabase transaction-pooler URLs carry sslmode=require; local URLs do not.
    ssl: databaseUrl.includes('sslmode=require') ? 'require' : false,
  });
  const db = drizzle(pool, { schema }) as AppDbWithPool;
  Object.defineProperty(db, '$client', { value: pool, enumerable: true });
  shared = db;
  return db;
}