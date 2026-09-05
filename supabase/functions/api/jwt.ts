import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { ApplicationError } from '../../../src/domain/errors.ts';
import type { ApiEnv } from './env.ts';
import type { VerifiedIdentity } from './identity.ts';

/**
 * Verifies a Supabase bearer JWT and derives the caller identity exclusively
 * from the verified token. Uses the injected SUPABASE_JWKS when present
 * (local and deployed Edge Runtime both provide it); falls back to the
 * HS256 shared secret for classic runtimes. The `sub` claim is the only
 * user ID the server ever trusts.
 */
export async function verifyAccessToken(token: string, env: ApiEnv): Promise<VerifiedIdentity> {
  let payload;
  try {
    const verified = env.jwkSet
      ? await jwtVerify(token, createLocalJWKSet(env.jwkSet as JSONWebKeySet), { algorithms: ['HS256', 'ES256'] })
      : await jwtVerify(token, new TextEncoder().encode(env.jwtSecret ?? ''), { algorithms: ['HS256'] });
    payload = verified.payload;
  } catch {
    throw new ApplicationError('UNAUTHENTICATED', 'Invalid or expired access token');
  }

  const userId = payload.sub;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new ApplicationError('UNAUTHENTICATED', 'Token is missing a subject');
  }
  return {
    userId,
    email: typeof payload.email === 'string' ? payload.email : null,
    issuedAt: typeof payload.iat === 'number' ? new Date(payload.iat * 1000).toISOString() : null,
    expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
  };
}

export function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1] : null;
}