import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { readApiEnv } from './env.ts';
import { getDb } from '../../../src/db/client.ts';
import { bearerToken, verifyAccessToken } from './jwt.ts';
import type { VerifiedIdentity } from './identity.ts';
import { appRouter } from './router.ts';
import type { ApiContext } from './trpc.ts';

declare const Deno: {
  serve(handler: (request: Request) => Promise<Response> | Response): void;
  env: { get(name: string): string | undefined };
};

const env = readApiEnv();

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = env.allowedOrigins.includes('*') || (origin !== null && env.allowedOrigins.includes(origin)) ? (origin ?? '*') : null;
  return {
    'Access-Control-Allow-Origin': allowed ?? 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Flashcard-Test-Clock, X-Flashcard-Test-Secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function requestNow(request: Request): Date {
  const suppliedSecret = request.headers.get('x-flashcard-test-secret');
  const suppliedClock = request.headers.get('x-flashcard-test-clock');
  if (env.testClockSecret === null || suppliedSecret !== env.testClockSecret || suppliedClock === null) return new Date();
  const now = new Date(suppliedClock);
  if (Number.isNaN(now.getTime())) return new Date();
  return now;
}

function buildContext(identity: VerifiedIdentity, now: Date): ApiContext {
  return { identity, db: getDb(env.databaseUrl), now };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return new Response(JSON.stringify({ error: { message: 'Authentication required', code: 'UNAUTHORIZED' } }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } });
  let identity: VerifiedIdentity;
  try {
    identity = await verifyAccessToken(token, env);
  } catch {
    return new Response(JSON.stringify({ error: { message: 'Invalid or expired access token', code: 'UNAUTHORIZED' } }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } });
  }
  const now = requestNow(request);
  return fetchRequestHandler({
    endpoint: '/api',
    req: request,
    router: appRouter,
    createContext: () => buildContext(identity, now),
    onError({ error }) {
      if (Deno.env.get('DEV') === 'true') console.error('tRPC error:', error.message);
    },
  });
});
