import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createActor, destroyActor, type TestActor } from '../../supabase/functions/api/acceptance/test-support/actor.ts';
import { acceptanceEnv, functionUrl } from '../../supabase/functions/api/acceptance/test-support/environment.ts';

let actor: TestActor | undefined;
let home: string | undefined;
afterEach(async () => { await destroyActor(actor); if (home) await rm(home, { recursive: true, force: true }); actor = undefined; home = undefined; });

async function command(args: string[], input?: string) {
  if (!home) throw new Error('Acceptance home was not initialized');
  const child = spawn(process.execPath, ['dist-cli/flashcard.mjs', ...args], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), FLASHCARD_SUPABASE_URL: acceptanceEnv.supabaseUrl, FLASHCARD_SUPABASE_PUBLISHABLE_KEY: acceptanceEnv.anonKey, FLASHCARD_API_URL: functionUrl },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(input);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const exitCode = await new Promise<number>((resolve) => child.once('exit', (code) => resolve(code ?? 1)));
  return { exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
}

function success(result: { exitCode: number; stdout: string; stderr: string }) {
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout).data;
}

describe('flashcard CLI', () => {
  test('authenticates and performs one-shot deck/card/review operations', async () => {
    actor = await createActor('cli-workflow');
    home = await mkdtemp(join(tmpdir(), 'flashcard-cli-acceptance-'));
    expect(success(await command(['auth', 'login', '--email', actor.email, '--password-stdin', '--credential-store', 'file'], actor.password))).toMatchObject({ userId: actor.userId, credentialStore: 'file' });
    expect(success(await command(['auth', 'session']))).toMatchObject({ userId: actor.userId });
    const sessionPath = join(home, 'config', 'flashcard', 'sessions', `${createHash('sha256').update(new URL(acceptanceEnv.supabaseUrl).href).digest('hex')}.json`);
    const stored = JSON.parse(await readFile(sessionPath, 'utf8'));
    await writeFile(sessionPath, JSON.stringify({ ...stored, accessToken: 'invalid-access-token' }));
    expect(success(await command(['auth', 'session']))).toMatchObject({ userId: actor.userId });
    const deck = success(await command(['deck', 'create', '--name', 'CLI deck']));
    expect(success(await command(['deck', 'list']))).toMatchObject({ decks: [{ id: deck.id }] });
    const renamedDeck = success(await command(['deck', 'rename', '--deck-id', deck.id, '--name', 'Renamed CLI deck', '--expected-version', String(deck.version)]));
    const card = success(await command(['card', 'create', '--input', '-'], JSON.stringify({ deckId: deck.id, name: 'Ruby', frontMarkdown: '<ruby>漢<rt>かん</rt></ruby>', backMarkdown: 'Chinese', tags: ['language'], speechText: null, speechLocale: null })));
    expect(success(await command(['card', 'get', '--card-id', card.id, '--deck-id', deck.id]))).toMatchObject({ id: card.id });
    expect(success(await command(['card', 'search', '--deck-id', deck.id, '--query', 'Ruby']))).toMatchObject({ cards: [{ id: card.id }] });
    const updated = success(await command(['card', 'update', '--card-id', card.id, '--deck-id', deck.id, '--name', 'Updated Ruby', '--front-markdown', '<ruby>漢<rt>かん</rt></ruby>', '--back-markdown', 'Chinese', '--tag', 'language', '--expected-version', String(card.version)]));
    const revisions = success(await command(['card', 'revisions', '--card-id', card.id, '--deck-id', deck.id]));
    const createdRevision = revisions.revisions.find((revision: { eventType: string }) => revision.eventType === 'created');
    expect(createdRevision).toBeDefined();
    const rolledBack = success(await command(['card', 'rollback', '--card-id', card.id, '--deck-id', deck.id, '--revision-id', createdRevision.id, '--expected-version', String(updated.version)]));
    const queue = success(await command(['deck', 'queue', '--deck-id', deck.id]));
    expect(queue.items.map((item: { id: string }) => item.id)).toContain(card.id);
    const rate = success(await command(['review', 'rate', '--card-id', card.id, '--deck-id', deck.id, '--rating', 'good', '--expected-version', String(rolledBack.version), '--request-id', '32a1ed45-cead-47c7-8147-d2111e711270']));
    expect(rate.reviewId).toEqual(expect.any(String));
    expect(success(await command(['review', 'history', '--card-id', card.id, '--deck-id', deck.id]))).toMatchObject({ events: [{ id: rate.reviewId }] });
    expect(success(await command(['review', 'undo', '--review-id', rate.reviewId, '--deck-id', deck.id]))).toHaveProperty('queue');
    const afterUndo = success(await command(['card', 'get', '--card-id', card.id, '--deck-id', deck.id]));
    expect(success(await command(['card', 'suspend', '--card-id', card.id, '--deck-id', deck.id, '--expected-version', String(afterUndo.version)])).queue.items).not.toContainEqual(expect.objectContaining({ id: card.id }));
    const suspended = success(await command(['card', 'get', '--card-id', card.id, '--deck-id', deck.id]));
    expect(success(await command(['card', 'restore', '--card-id', card.id, '--deck-id', deck.id, '--expected-version', String(suspended.version)])).card).toMatchObject({ id: card.id, suspended: false });
    const restored = success(await command(['card', 'get', '--card-id', card.id, '--deck-id', deck.id]));
    const refusal = await command(['card', 'remove', '--card-id', card.id, '--deck-id', deck.id, '--expected-version', String(restored.version)]);
    expect(refusal.exitCode).toBe(1);
    expect(JSON.parse(refusal.stderr).error.code).toBe('CONFIRMATION_REQUIRED');
    expect(success(await command(['card', 'remove', '--card-id', card.id, '--deck-id', deck.id, '--expected-version', String(restored.version), '--yes']))).toHaveProperty('queue');
    expect(success(await command(['deck', 'remove', '--deck-id', deck.id, '--expected-version', String(renamedDeck.version), '--yes']))).toEqual({ removed: true });
    expect(success(await command(['auth', 'logout']))).toMatchObject({ loggedOut: true, hadSession: true });
    const missing = await command(['auth', 'session']);
    expect(JSON.parse(missing.stderr).error.code).toBe('UNAUTHENTICATED');
  });
});
