import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client.ts';
import type { ApiClientOptions } from './client.ts';

function successfulSession(): Response {
  return new Response(JSON.stringify([{ result: { data: { userId: '36f85b48-6e07-4b25-aa0b-626138f01f8d', email: null, issuedAt: null, expiresAt: null } } }]), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: { message: 'Authentication required' } }), { status: 401 });
}

function responseQueue(...responses: Response[]): NonNullable<ApiClientOptions['fetch']> & { calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL | string, init?: RequestInit) => {
    calls.push(init ?? {});
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request');
    return response;
  }) as unknown as NonNullable<ApiClientOptions['fetch']>;
  return Object.assign(fetch, { calls });
}

function authorization(init: RequestInit): string | null {
  return new Headers(init.headers).get('Authorization');
}

describe('createApiClient', () => {
  it('reads the token for every request and omits the header with no session', async () => {
    let token: string | null = 'first-token';
    const fetch = responseQueue(successfulSession(), successfulSession(), successfulSession());
    const client = createApiClient({
      apiUrl: 'http://localhost:54321/functions/v1/api',
      getAccessToken: async () => token,
      clearSession: vi.fn(),
      fetch,
    });

    await client.auth.session.query({});
    token = 'second-token';
    await client.auth.session.query({});
    token = null;
    await client.auth.session.query({});

    expect(fetch.calls.map(authorization)).toEqual(['Bearer first-token', 'Bearer second-token', null]);
  });

  it('refreshes once and retries the original request with the refreshed token', async () => {
    let token: string | null = 'expired-token';
    const refreshSession = vi.fn(async () => {
      token = 'refreshed-token';
      return true;
    });
    const clearSession = vi.fn();
    const fetch = responseQueue(unauthorized(), successfulSession());
    const client = createApiClient({
      apiUrl: 'http://localhost:54321/functions/v1/api',
      getAccessToken: async () => token,
      refreshSession,
      clearSession,
      fetch,
    });

    await client.auth.session.query({});

    expect(refreshSession).toHaveBeenCalledOnce();
    expect(clearSession).not.toHaveBeenCalled();
    expect(fetch.calls.map(authorization)).toEqual(['Bearer expired-token', 'Bearer refreshed-token']);
  });

  it('clears the session after the retry is unauthorized', async () => {
    let token = 'expired-token';
    const refreshSession = vi.fn(async () => {
      token = 'still-invalid-token';
      return true;
    });
    const clearSession = vi.fn();
    const fetch = responseQueue(unauthorized(), unauthorized());
    const client = createApiClient({
      apiUrl: 'http://localhost:54321/functions/v1/api',
      getAccessToken: async () => token,
      refreshSession,
      clearSession,
      fetch,
    });

    await expect(client.auth.session.query({})).rejects.toThrow();

    expect(refreshSession).toHaveBeenCalledOnce();
    expect(clearSession).toHaveBeenCalledOnce();
    expect(fetch.calls.map(authorization)).toEqual(['Bearer expired-token', 'Bearer still-invalid-token']);
  });
});
