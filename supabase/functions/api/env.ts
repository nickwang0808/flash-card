/**
 * Edge environment access. `Deno` exists at runtime inside the Supabase Edge
 * Runtime; the ambient declaration keeps this file type-checkable under Node
 * tooling without pulling in Deno's global types for the whole repository.
 */
declare const Deno: {
  env: { get(name: string): string | undefined };
};

export interface ApiEnv {
  /** JWKS injected by the Supabase Edge Runtime; local and deployed both provide it. */
  jwkSet: unknown;
  /** Legacy fallback for runtimes without SUPABASE_JWKS. */
  jwtSecret: string | null;
  databaseUrl: string;
  allowedOrigins: readonly string[];
}

export function readApiEnv(): ApiEnv {
  const jwkSetRaw = Deno.env.get('SUPABASE_JWKS');
  const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET') ?? Deno.env.get('SUPABASE_INTERNAL_JWT_SECRET') ?? null;
  // SUPABASE_DB_URL is container-reachable in the local Edge Runtime;
  // deployed functions receive DATABASE_URL as the transaction-pooler secret.
  const databaseUrl = Deno.env.get('SUPABASE_DB_URL') ?? Deno.env.get('DATABASE_URL');
  const allowedOrigins = (Deno.env.get('API_ALLOWED_ORIGINS') ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!jwkSetRaw && !jwtSecret) {
    throw new Error('Neither SUPABASE_JWKS nor SUPABASE_JWT_SECRET is configured');
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or SUPABASE_DB_URL is not configured');
  }

  let jwkSet: unknown = null;
  if (jwkSetRaw) {
    try {
      jwkSet = JSON.parse(jwkSetRaw) as unknown;
    } catch {
      throw new Error('SUPABASE_JWKS is not valid JSON');
    }
  }

  return { jwkSet, jwtSecret, databaseUrl, allowedOrigins };
}