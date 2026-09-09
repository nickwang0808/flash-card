import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { corsHeaders, withCors } from './cors.ts';
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
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env.allowedOrigins) });
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return withCors(new Response(JSON.stringify({ error: { message: 'Authentication required', code: 'UNAUTHORIZED' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }), request, env.allowedOrigins);
  let identity: VerifiedIdentity;
  try {
    identity = await verifyAccessToken(token, env);
  } catch {
    return withCors(new Response(JSON.stringify({ error: { message: 'Invalid or expired access token', code: 'UNAUTHORIZED' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }), request, env.allowedOrigins);
  }
  const now = requestNow(request);
  const response = await fetchRequestHandler({
    endpoint: '/api',
    req: request,
    router: appRouter,
    createContext: () => buildContext(identity, now),
    onError({ error }) {
      if (Deno.env.get('DEV') === 'true') console.error('tRPC error:', error.message);
    },
  });
  return withCors(response, request, env.allowedOrigins);
});
