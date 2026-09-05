import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { readApiEnv } from './env.ts';
import { getDb } from '../../../src/db/client.ts';
import { bearerToken, verifyAccessToken } from './jwt.ts';
import type { VerifiedIdentity } from './identity.ts';
import { appRouter } from './router.ts';
import type { ApiContext } from './trpc.ts';
import { PostgresCardRepository } from './repositories/CardRepository.ts';
import { PostgresDeckRepository } from './repositories/DeckRepository.ts';
import { PostgresStudyRepository } from './repositories/StudyRepository.ts';
import { CardService } from './services/CardService.ts';
import { DeckService } from './services/DeckService.ts';
import { StudyService } from './services/StudyService.ts';

/** Ambient Deno global; present at runtime inside the Supabase Edge Runtime. */
declare const Deno: {
  serve(handler: (request: Request) => Promise<Response> | Response): void;
  env: { get(name: string): string | undefined };
};

const env = readApiEnv();

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed =
    env.allowedOrigins.includes('*') || (origin !== null && env.allowedOrigins.includes(origin))
      ? (origin ?? '*')
      : null;
  return {
    'Access-Control-Allow-Origin': allowed ?? 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function buildContext(identity: VerifiedIdentity): ApiContext {
  const sql = getDb(env.databaseUrl);
  const deckRepository = new PostgresDeckRepository(sql, identity.userId);
  const cardRepository = new PostgresCardRepository(sql, identity.userId);
  const studyRepository = new PostgresStudyRepository(sql, identity.userId);
  return {
    identity,
    services: {
      decks: new DeckService(deckRepository),
      cards: new CardService(cardRepository, deckRepository),
      study: new StudyService(studyRepository),
    },
  };
}

/**
 * Supabase Edge Function entry. JWT is verified before the tRPC handler runs;
 * the caller's user ID is derived only from the verified token.
 */
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const token = bearerToken(request.headers.get('authorization'));
  if (!token) {
    return new Response(
      JSON.stringify({ error: { message: 'Authentication required', code: 'UNAUTHORIZED' } }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    );
  }

  let identity;
  try {
    identity = await verifyAccessToken(token, env);
  } catch {
    return new Response(
      JSON.stringify({ error: { message: 'Invalid or expired access token', code: 'UNAUTHORIZED' } }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } },
    );
  }

  return fetchRequestHandler({
    endpoint: '/api',
    req: request,
    router: appRouter,
    createContext: () => buildContext(identity),
    onError({ error }) {
      if (Deno.env.get('DEV') === 'true') {
        console.error('tRPC error:', error.message);
      }
    },
  });
});