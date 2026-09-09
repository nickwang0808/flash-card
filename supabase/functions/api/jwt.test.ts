import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import type { ApiEnv } from './env.ts';
import { verifyAccessToken } from './jwt.ts';

const secret = new TextEncoder().encode('test-signing-secret-that-is-long-enough');
const environment: ApiEnv = {
  jwkSet: null,
  jwtSecret: new TextDecoder().decode(secret),
  authIssuer: 'https://project.supabase.co/auth/v1',
  databaseUrl: 'postgres://unused',
  allowedOrigins: [],
  testClockSecret: null,
};

async function signedToken(overrides: Record<string, unknown> = {}, issuer = environment.authIssuer, audience = 'authenticated') {
  const { role = 'authenticated', email = 'person@example.com', client_id, ...claims } = overrides;
  const token = new SignJWT({ role, email, ...(client_id === undefined ? {} : { client_id }), ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-1111-4111-8111-111111111111')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('1h');
  return token.sign(secret);
}

describe('verifyAccessToken', () => {
  it('accepts a first-party user JWT and preserves OAuth client provenance', async () => {
    await expect(verifyAccessToken(await signedToken({ client_id: 'cli-client-id' }), environment)).resolves.toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'person@example.com',
      clientId: 'cli-client-id',
    });
  });

  it.each([
    ['issuer', signedToken({}, 'https://other.supabase.co/auth/v1')],
    ['audience', signedToken({}, environment.authIssuer, 'other-api')],
    ['role', signedToken({ role: 'anon' })],
  ])('rejects a token with the wrong %s claim', async (_claim, token) => {
    await expect(verifyAccessToken(await token, environment)).rejects.toThrow();
  });
});
