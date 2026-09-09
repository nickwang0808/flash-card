import { randomUUID } from 'node:crypto';
import { CommanderError } from 'commander';
import { z } from 'zod';
import { readCliEnvironment, type CliEnvironment } from '../api/environment.ts';
import { CliError, toCliError } from './errors.ts';
import { type CredentialStoreKind } from './credentials.ts';
import type { StoredSession } from './credentials.ts';
import { authorizeWithOAuth, type OAuthLoginOptions } from './oauth.ts';
import { numberFlag, parseInput, schemas, validate } from './input.ts';
import { createProgram } from './program.ts';
import { SessionManager } from './session.ts';
interface CliIo {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
  stderr: NodeJS.WritableStream & { isTTY?: boolean };
  environment?: NodeJS.ProcessEnv;
}

type Options = Record<string, unknown>;

type CliSessionManager = Pick<SessionManager, 'api' | 'kind' | 'logout' | 'requireSession' | 'save'>;

export interface CliRuntime {
  createSessionManager: (environment: CliEnvironment, requestedKind?: CredentialStoreKind) => Promise<CliSessionManager>;
  authorize: (environment: CliEnvironment, options: OAuthLoginOptions) => Promise<StoredSession>;
  createRequestId: () => string;
}

const defaultRuntime: CliRuntime = {
  createSessionManager: SessionManager.create,
  authorize: authorizeWithOAuth,
  createRequestId: randomUUID,
};

export async function runCli(argv: string[], io: CliIo, runtime: CliRuntime = defaultRuntime): Promise<number> {
  let result: unknown;
  let actionStarted = false;
  const program = createProgram(async (operation, options) => {
    actionStarted = true;
    result = await runOperation(operation, options, io, runtime);
  }, (text) => io.stdout.write(text));
  program.exitOverride();
  try {
    await program.parseAsync(argv, { from: 'user' });
    if (result !== undefined) io.stdout.write(`${JSON.stringify({ ok: true, data: result })}\n`);
    else if (argv.length === 0) {
      program.outputHelp();
    }
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && ['commander.helpDisplayed', 'commander.version'].includes(error.code)) return 0;
    const cliError = !actionStarted || error instanceof CommanderError || (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && error.code.startsWith('commander.')) ? new CliError('USAGE_ERROR', 'Invalid command usage') : toCliError(error);
    io.stderr.write(`${JSON.stringify({ ok: false, error: { code: cliError.code, message: cliError.message, ...(cliError.details ? { details: cliError.details } : {}) } })}\n`);
    return 1;
  }
}

async function runOperation(operation: string, options: Options, io: CliIo, runtime: CliRuntime): Promise<unknown> {
  if (operation === 'auth.login') return login(options, io, runtime);
  const environment = readCliEnvironment(io.environment ?? process.env);
  const manager = await runtime.createSessionManager(environment);
  if (operation === 'auth.logout') {
    const result = await manager.logout();
    return { loggedOut: true, ...result };
  }
  if (operation === 'auth.session') {
    await manager.requireSession();
    return manager.api().auth.session.query({});
  }
  await manager.requireSession();
  const client = manager.api();
  switch (operation) {
    case 'deck.list': return client.deck.list.query({});
    case 'deck.create': return client.deck.create.mutate(await input(options, schemas.deckCreate, io, () => ({ name: text(options.name), defaultSpeechLocale: nullableText(options.defaultSpeechLocale) })));
    case 'deck.rename': return client.deck.rename.mutate(await input(options, schemas.deckRename, io, () => ({ deckId: text(options.deckId), name: text(options.name), expectedVersion: integer(options.expectedVersion) })));
    case 'deck.remove': return client.deck.remove.mutate({ ...(await input(options, schemas.deckRemove, io, () => ({ deckId: text(options.deckId), expectedVersion: integer(options.expectedVersion) }))), confirmation: await confirmation('deck', text(options.deckId), options.yes, io) });
    case 'deck.queue': return client.deck.queue.query(await input(options, schemas.deckQueue, io, () => ({ deckId: text(options.deckId), limit: optionalInteger(options.limit) })));
    case 'card.get': return client.card.get.query(await input(options, schemas.cardGet, io, () => ({ cardId: text(options.cardId), deckId: text(options.deckId) })));
    case 'card.search': return client.card.search.query(await input(options, schemas.cardSearch, io, () => ({ deckId: nullableText(options.deckId), query: text(options.query), pagination: page(options) })));
    case 'card.create': return client.card.create.mutate(await input(options, schemas.cardCreate, io, () => cardContent(options)));
    case 'card.import': return client.card.import.mutate(await input(options, schemas.cardImport, io, () => ({})));
    case 'card.update': return client.card.update.mutate(await input(options, schemas.cardUpdate, io, () => ({ ...cardContent(options), cardId: text(options.cardId), expectedVersion: integer(options.expectedVersion) })));
    case 'card.suspend': return client.card.suspend.mutate(await input(options, schemas.cardQueueMutation, io, () => queueMutation(options)));
    case 'card.restore': return client.card.restore.mutate(await input(options, schemas.cardQueueMutation, io, () => queueMutation(options)));
    case 'card.remove': return client.card.remove.mutate({ ...(await input(options, schemas.cardRemove, io, () => queueMutation(options))), confirmation: await confirmation('card', text(options.cardId), options.yes, io) });
    case 'card.revisions': return client.card.revisions.query(await input(options, schemas.cardRevisions, io, () => ({ cardId: text(options.cardId), deckId: text(options.deckId), pagination: page(options) })));
    case 'card.rollback': return client.card.rollbackRevision.mutate(await input(options, schemas.cardRollback, io, () => ({ cardId: text(options.cardId), deckId: text(options.deckId), revisionId: text(options.revisionId), expectedVersion: integer(options.expectedVersion) })));
    case 'review.rate': {
      const request = await input(options, schemas.reviewRate, io, () => ({ cadenceId: text(options.cadenceId), deckId: text(options.deckId), rating: text(options.rating), expectedVersion: integer(options.expectedVersion), requestId: optionalText(options.requestId), queue: queue(options) }));
      return client.review.rate.mutate({ ...request, requestId: request.requestId ?? runtime.createRequestId() });
    }
    case 'review.history': return client.review.history.query(await input(options, schemas.reviewHistory, io, () => ({ cadenceId: text(options.cadenceId), deckId: text(options.deckId), pagination: page(options) })));
    case 'review.undo': return client.review.undo.mutate(await input(options, schemas.reviewUndo, io, () => ({ reviewId: text(options.reviewId), deckId: text(options.deckId), queue: queue(options) })));
    default: throw new CliError('USAGE_ERROR', 'Unknown command');
  }
}

async function login(options: Options, io: CliIo, runtime: CliRuntime): Promise<unknown> {
  const requested = options.credentialStore;
  if (requested !== undefined && requested !== 'keyring' && requested !== 'file') throw new CliError('VALIDATION_FAILED', 'Credential store must be keyring or file');
  const environment = readCliEnvironment(io.environment ?? process.env);
  const manager = await runtime.createSessionManager(environment, requested as CredentialStoreKind | undefined);
  const session = await runtime.authorize(environment, {
    openBrowser: options.open !== false,
    showAuthorizationUrl(url) {
      io.stderr.write(`Open this URL in a browser to authorize Flash Cards:${String.fromCharCode(10)}${url}${String.fromCharCode(10)}`);
    },
  });
  await manager.save(session, true);
  return { credentialStore: manager.kind };
}

async function input<T extends z.ZodType>(options: Options, schema: T, io: CliIo, fromFlags: () => unknown): Promise<z.output<T>> {
  if (typeof options.input === 'string') {
    const supplied = Object.entries(options).some(([key, value]) => key !== 'input' && key !== 'yes' && value !== undefined && !(key === 'tag' && Array.isArray(value) && value.length === 0) && !(key === 'reversible' && value === false));
    if (supplied) throw new CliError('USAGE_ERROR', 'Use flags or --input, not both');
    return parseInput(options.input, schema, io.stdin);
  }
  return validate(schema, fromFlags());
}

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function optionalText(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function nullableText(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function integer(value: unknown): number { return numberFlag(text(value)); }
function optionalInteger(value: unknown): number | undefined { return value === undefined ? undefined : integer(value); }
function queue(options: Options) { return { limit: optionalInteger(options.limit) ?? 50 }; }
function page(options: Options) { return { cursor: optionalText(options.cursor), limit: optionalInteger(options.limit) ?? 50 }; }
function cardContent(options: Options) { return { deckId: text(options.deckId), name: text(options.name), frontMarkdown: text(options.frontMarkdown), backMarkdown: text(options.backMarkdown), tags: Array.isArray(options.tag) ? options.tag.map(String) : [], speechText: nullableText(options.speechText), speechLocale: nullableText(options.speechLocale), speechSide: nullableText(options.speechSide), reversible: options.reversible === true }; }
function queueMutation(options: Options) { return { cardId: text(options.cardId), deckId: text(options.deckId), expectedVersion: integer(options.expectedVersion), queue: queue(options) }; }

async function confirmation(kind: 'deck' | 'card', id: string, yes: unknown, io: CliIo): Promise<true> {
  if (yes === true) return true;
  if (!io.stdin.isTTY || !io.stderr.isTTY) throw new CliError('CONFIRMATION_REQUIRED', 'Deletion requires --yes outside an interactive terminal');
  const prompt = kind === 'deck' ? `Delete deck ${id} and all of its cards? [y/N] ` : `Delete card ${id} and its history? [y/N] `;
  io.stderr.write(prompt);
  const answer = (await readTtyLine(io)).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') throw new CliError('CANCELLED', 'Deletion cancelled');
  return true;
}

async function readTtyLine(io: CliIo): Promise<string> {
  if (!io.stdin.isTTY || !io.stderr.isTTY) throw new CliError('USAGE_ERROR', 'Interactive terminal input is unavailable');
  const stdin = io.stdin as NodeJS.ReadableStream & { setRawMode?: (enabled: boolean) => void; resume(): void };
  if (!stdin.setRawMode) throw new CliError('USAGE_ERROR', 'Interactive terminal does not support terminal input');
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode?.(false);
    };
    const onData = (chunk: Buffer | string) => {
      const input = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      if (input === '\u0003') {
        cleanup();
        reject(new CliError('CANCELLED', 'Operation cancelled'));
      } else if (input === '\r' || input === '\n') {
        cleanup();
        io.stderr.write('\n');
        resolve(value);
      } else if (input === '\u007f' || input === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          io.stderr.write('\b \b');
        }
      } else if (!/[\u0000-\u001f\u007f]/.test(input)) {
        value += input;
        io.stderr.write(input);
      }
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

