import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../../../../src/db/schema.ts';
import { acceptanceEnv } from './environment.ts';

let pool: postgres.Sql | undefined;

export function fixtureDb() {
  pool ??= postgres(acceptanceEnv.databaseUrl, { max: 2, ssl: false });
  return drizzle(pool, { schema });
}

export async function closeFixtureDb(): Promise<void> {
  await pool?.end({ timeout: 5 });
  pool = undefined;
}
