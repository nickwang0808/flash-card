import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { platform } from 'node:os';
import { spawn } from 'node:child_process';

import type { CliEnvironment } from '../api/environment.ts';
import type { StoredSession } from './credentials.ts';
import { CliError } from './errors.ts';

export const OAUTH_CALLBACK_URL = 'http://127.0.0.1:43821/oauth/callback';
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

interface PkceParameters {
  verifier: string;
  challenge: string;
  state: string;
}

export interface OAuthLoginOptions {
  openBrowser: boolean;
  showAuthorizationUrl(url: string): void;
}

export function createPkceParameters(): PkceParameters {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  };
}

export function authorizationUrl(environment: CliEnvironment, pkce: PkceParameters): string {
  const url = new URL('/auth/v1/oauth/authorize', environment.supabaseUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: environment.oauthClientId,
    redirect_uri: OAUTH_CALLBACK_URL,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: pkce.state,
    scope: 'openid email profile',
  }).toString();
  return url.href;
}

interface OAuthCallback {
  wait(): Promise<{ code: string; state: string }>;
  close(): Promise<void>;
}

export async function authorizeWithOAuth(environment: CliEnvironment, options: OAuthLoginOptions): Promise<StoredSession> {
  const pkce = createPkceParameters();
  const callback = await awaitCallback();
  const response = callback.wait();
  try {
    const url = authorizationUrl(environment, pkce);
    if (options.openBrowser) await openBrowser(url);
    else options.showAuthorizationUrl(url);
    const code = await response;
    if (code.state.length !== pkce.state.length || !timingSafeEqual(Buffer.from(code.state), Buffer.from(pkce.state))) {
      throw new CliError('AUTHENTICATION_FAILED', 'Authorization response did not match this login attempt');
    }
    return exchangeAuthorizationCode(environment, code.code, pkce.verifier);
  } finally {
    await callback.close();
  }
}

async function awaitCallback(): Promise<OAuthCallback> {
  let settle: ((value: { code: string; state: string }) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  let timeout: NodeJS.Timeout | undefined;
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', OAUTH_CALLBACK_URL);
    if (requestUrl.pathname !== '/oauth/callback') {
      response.writeHead(404).end();
      return;
    }
    const error = requestUrl.searchParams.get('error');
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');
    if (error || !code || !state) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Flash Cards authorization failed</title><p>Authorization failed. Return to the terminal.</p>');
      fail?.(new CliError('AUTHENTICATION_FAILED', error === 'access_denied' ? 'Authorization was denied' : 'Authorization callback was invalid'));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Flash Cards authorized</title><p>Authorization succeeded. You may close this window.</p>');
    settle?.({ code, state });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(43821, '127.0.0.1');
  }).catch(() => { throw new CliError('AUTHENTICATION_FAILED', 'Could not start the local authorization callback listener'); });

  return {
    wait() {
      return new Promise<{ code: string; state: string }>((resolve, reject) => {
        settle = (value) => {
          clearTimeout(timeout);
          resolve(value);
        };
        fail = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
        timeout = setTimeout(() => fail?.(new CliError('AUTHENTICATION_FAILED', 'Authorization timed out')), CALLBACK_TIMEOUT_MS);
      });
    },
    async close() {
      clearTimeout(timeout);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function exchangeAuthorizationCode(environment: CliEnvironment, code: string, verifier: string): Promise<StoredSession> {
  let response: Response;
  try {
    response = await fetch(new URL('/auth/v1/oauth/token', environment.supabaseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: environment.oauthClientId,
        redirect_uri: OAUTH_CALLBACK_URL,
        code_verifier: verifier,
      }),
    });
  } catch {
    throw new CliError('TRANSPORT_ERROR', 'Authentication service could not complete authorization');
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new CliError('AUTHENTICATION_FAILED', 'Authentication service returned an invalid authorization response'); }
  if (!response.ok || typeof data !== 'object' || data === null) throw new CliError('AUTHENTICATION_FAILED', 'Authorization code exchange failed');
  const tokens = data as Record<string, unknown>;
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || !tokens.access_token || !tokens.refresh_token) {
    throw new CliError('AUTHENTICATION_FAILED', 'Authentication service returned incomplete credentials');
  }
  return { version: 1, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

async function openBrowser(url: string): Promise<void> {
  const operatingSystem = platform();
  const command = operatingSystem === 'darwin' ? 'open' : operatingSystem === 'win32' ? 'cmd' : 'xdg-open';
  const args = operatingSystem === 'win32' ? ['/c', 'start', '', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.unref();
    resolve();
  }).catch(() => { throw new CliError('AUTHENTICATION_FAILED', 'Could not open a browser; retry with --no-open'); });
}
