import { describe, expect, it } from 'vitest';

import type { CliEnvironment } from '../api/environment.ts';
import { authorizationUrl, createPkceParameters, OAUTH_CALLBACK_URL } from './oauth.ts';

const environment: CliEnvironment = {
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'publishable-key',
  apiUrl: 'https://project.supabase.co/functions/v1/api',
  oauthClientId: 'cli-client-id',
};

describe('CLI OAuth authorization requests', () => {
  it('creates independent S256 PKCE challenges', () => {
    const first = createPkceParameters();
    const second = createPkceParameters();

    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.verifier).not.toBe(first.verifier);
    expect(second.state).not.toBe(first.state);
  });

  it('binds the authorization request to the public client and loopback callback', () => {
    const url = new URL(authorizationUrl(environment, createPkceParameters()));

    expect(url.origin + url.pathname).toBe('https://project.supabase.co/auth/v1/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'cli-client-id',
      redirect_uri: OAUTH_CALLBACK_URL,
      code_challenge_method: 'S256',
      scope: 'openid email profile',
    });
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
