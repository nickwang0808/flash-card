import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client.ts';
import type { CliRuntime } from './run.ts';
import { runCli } from './run.ts';

function stdin(input = ''): PassThrough {
  const value = new PassThrough();
  value.end(input);
  return value;
}

function captured(): { stream: Writable; text: () => string } {
  let value = '';
  return { stream: new Writable({ write(chunk, _encoding, callback) { value += Buffer.from(chunk).toString('utf8'); callback(); } }), text: () => value };
}

const environment = {
  FLASHCARD_SUPABASE_URL: 'http://127.0.0.1:54321',
  FLASHCARD_SUPABASE_PUBLISHABLE_KEY: 'public-key',
  FLASHCARD_API_URL: 'http://127.0.0.1:54321/functions/v1/api',
};
const ids = {
  deck: '11111111-1111-4111-8111-111111111111',
  card: '22222222-2222-4222-8222-222222222222',
  revision: '33333333-3333-4333-8333-333333333333',
  review: '44444444-4444-4444-8444-444444444444',
  request: '55555555-5555-4555-8555-555555555555',
};

function fakeRuntime(calls: Array<{ operation: string; input: unknown }>): CliRuntime {
  const query = (operation: string) => async (input: unknown) => {
    calls.push({ operation, input });
    return { operation, input };
  };
  const api = {
    auth: { session: { query: query('auth.session') } },
    deck: {
      list: { query: query('deck.list') },
      create: { mutate: query('deck.create') },
      rename: { mutate: query('deck.rename') },
      remove: { mutate: query('deck.remove') },
      queue: { query: query('deck.queue') },
    },
    card: {
      get: { query: query('card.get') },
      search: { query: query('card.search') },
      create: { mutate: query('card.create') },
      update: { mutate: query('card.update') },
      suspend: { mutate: query('card.suspend') },
      restore: { mutate: query('card.restore') },
      remove: { mutate: query('card.remove') },
      revisions: { query: query('card.revisions') },
      rollbackRevision: { mutate: query('card.rollbackRevision') },
    },
    review: {
      rate: { mutate: query('review.rate') },
      history: { query: query('review.history') },
      undo: { mutate: query('review.undo') },
    },
  } as unknown as ApiClient;
  const login = vi.fn(async (email: string, password: string) => {
    calls.push({ operation: 'auth.login', input: { email, password } });
    return { userId: 'user-id', email: 'person@example.com', session: { version: 1 as const, accessToken: 'access-token', refreshToken: 'refresh-token' } };
  });
  const save = vi.fn(async (session: unknown, remember: unknown) => {
    calls.push({ operation: 'auth.save', input: { session, remember } });
  });
  return {
    createSessionManager: async () => ({
      kind: 'file',
      api: () => api,
      login,
      save,
      requireSession: async () => ({ version: 1, accessToken: 'access-token', refreshToken: 'refresh-token' }),
      logout: async () => ({ hadSession: true }),
    }),
    createRequestId: vi.fn(() => ids.request),
  };
}

async function execute(argv: string[], runtime: CliRuntime, input = '') {
  const stdout = captured();
  const stderr = captured();
  const status = await runCli(argv, { stdin: stdin(input), stdout: stdout.stream, stderr: stderr.stream, environment }, runtime);
  return { status, stdout: stdout.text(), stderr: stderr.text() };
}

describe('runCli', () => {
  it('keeps conventional version output independent from configuration', async () => {
    const stdout = captured();
    const stderr = captured();
    const status = await runCli(['--version'], { stdin: stdin(), stdout: stdout.stream, stderr: stderr.stream, environment: {} });
    expect(status).toBe(0);
    expect(stdout.text()).toBe('0.1.0\n');
    expect(stderr.text()).toBe('');
  });

  it('writes one structured configuration failure to stderr only', async () => {
    const stdout = captured();
    const stderr = captured();
    const status = await runCli(['auth', 'session'], { stdin: stdin(), stdout: stdout.stream, stderr: stderr.stream, environment: {} });
    expect(status).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toEqual({ ok: false, error: { code: 'CONFIGURATION_ERROR', message: 'CLI environment is incomplete or invalid' } });
  });

  it('rejects malformed arguments without Commander diagnostics', async () => {
    const stdout = captured();
    const stderr = captured();
    const status = await runCli(['deck', 'create', '--unknown'], { stdin: stdin(), stdout: stdout.stream, stderr: stderr.stream, environment: {} });
    expect(status).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toEqual({ ok: false, error: { code: 'USAGE_ERROR', message: 'Invalid command usage' } });
  });
  it('maps parsed commands to the sole API client with exact inputs', async () => {
    const calls: Array<{ operation: string; input: unknown }> = [];
    const runtime = fakeRuntime(calls);
    const commands = [
      { argv: ['auth', 'login', '--email', 'person@example.com', '--password-stdin', '--credential-store', 'file'], stdin: 'password', operation: 'auth.login', input: { email: 'person@example.com', password: 'password' } },
      { argv: ['auth', 'session'], operation: 'auth.session', input: {} },
      { argv: ['deck', 'list'], operation: 'deck.list', input: {} },
      { argv: ['deck', 'create', '--name', 'Deck', '--default-speech-locale', 'en-US'], operation: 'deck.create', input: { name: 'Deck', defaultSpeechLocale: 'en-US' } },
      { argv: ['deck', 'rename', '--deck-id', ids.deck, '--name', 'Renamed', '--expected-version', '2'], operation: 'deck.rename', input: { deckId: ids.deck, name: 'Renamed', expectedVersion: 2 } },
      { argv: ['deck', 'remove', '--deck-id', ids.deck, '--expected-version', '3', '--yes'], operation: 'deck.remove', input: { deckId: ids.deck, expectedVersion: 3, confirmation: true } },
      { argv: ['deck', 'queue', '--deck-id', ids.deck, '--limit', '4'], operation: 'deck.queue', input: { deckId: ids.deck, limit: 4 } },
      { argv: ['card', 'get', '--card-id', ids.card, '--deck-id', ids.deck], operation: 'card.get', input: { cardId: ids.card, deckId: ids.deck } },
      { argv: ['card', 'search', '--deck-id', ids.deck, '--query', 'term', '--cursor', 'opaque', '--limit', '5'], operation: 'card.search', input: { deckId: ids.deck, query: 'term', pagination: { cursor: 'opaque', limit: 5 } } },
      { argv: ['card', 'create', '--input', '-'], stdin: JSON.stringify({ deckId: ids.deck, name: 'Card', frontMarkdown: 'Front', backMarkdown: 'Back', tags: ['tag'], speechText: null, speechLocale: null }), operation: 'card.create', input: { deckId: ids.deck, name: 'Card', frontMarkdown: 'Front', backMarkdown: 'Back', tags: ['tag'], speechText: null, speechLocale: null } },
      { argv: ['card', 'update', '--card-id', ids.card, '--deck-id', ids.deck, '--name', 'Card', '--front-markdown', 'Front', '--back-markdown', 'Back', '--expected-version', '4'], operation: 'card.update', input: { cardId: ids.card, deckId: ids.deck, name: 'Card', frontMarkdown: 'Front', backMarkdown: 'Back', tags: [], speechText: null, speechLocale: null, expectedVersion: 4 } },
      { argv: ['card', 'suspend', '--card-id', ids.card, '--deck-id', ids.deck, '--expected-version', '5', '--limit', '6'], operation: 'card.suspend', input: { cardId: ids.card, deckId: ids.deck, expectedVersion: 5, queue: { limit: 6 } } },
      { argv: ['card', 'restore', '--card-id', ids.card, '--deck-id', ids.deck, '--expected-version', '6', '--limit', '7'], operation: 'card.restore', input: { cardId: ids.card, deckId: ids.deck, expectedVersion: 6, queue: { limit: 7 } } },
      { argv: ['card', 'remove', '--card-id', ids.card, '--deck-id', ids.deck, '--expected-version', '7', '--limit', '8', '--yes'], operation: 'card.remove', input: { cardId: ids.card, deckId: ids.deck, expectedVersion: 7, queue: { limit: 8 }, confirmation: true } },
      { argv: ['card', 'revisions', '--card-id', ids.card, '--deck-id', ids.deck, '--cursor', 'opaque', '--limit', '9'], operation: 'card.revisions', input: { cardId: ids.card, deckId: ids.deck, pagination: { cursor: 'opaque', limit: 9 } } },
      { argv: ['card', 'rollback', '--card-id', ids.card, '--deck-id', ids.deck, '--revision-id', ids.revision, '--expected-version', '8'], operation: 'card.rollbackRevision', input: { cardId: ids.card, deckId: ids.deck, revisionId: ids.revision, expectedVersion: 8 } },
      { argv: ['review', 'rate', '--card-id', ids.card, '--deck-id', ids.deck, '--rating', 'good', '--expected-version', '9', '--limit', '10'], operation: 'review.rate', input: { cardId: ids.card, deckId: ids.deck, rating: 'good', expectedVersion: 9, requestId: ids.request, queue: { limit: 10 } } },
      { argv: ['review', 'history', '--card-id', ids.card, '--deck-id', ids.deck, '--cursor', 'opaque', '--limit', '11'], operation: 'review.history', input: { cardId: ids.card, deckId: ids.deck, pagination: { cursor: 'opaque', limit: 11 } } },
      { argv: ['review', 'undo', '--review-id', ids.review, '--deck-id', ids.deck, '--limit', '12'], operation: 'review.undo', input: { reviewId: ids.review, deckId: ids.deck, queue: { limit: 12 } } },
    ];

    for (const command of commands) {
      const result = await execute(command.argv, runtime, command.stdin);
      expect(result).toMatchObject({ status: 0, stderr: '' });
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    }

    expect(calls.filter((call) => call.operation !== 'auth.save')).toEqual(commands.map(({ operation, input }) => ({ operation, input })));
    expect(calls).toContainEqual({
      operation: 'auth.save',
      input: { session: { version: 1, accessToken: 'access-token', refreshToken: 'refresh-token' }, remember: true },
    });
    expect(runtime.createRequestId).toHaveBeenCalledOnce();
  });
});
