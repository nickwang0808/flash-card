import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const npx = '/home/nick/.nvm/versions/node/v24.18.0/bin/npx';
const docker = '/usr/bin/docker';
const acceptancePrefix = 'acceptance-';
let functionProcess;
let runtimeOwned = false;
let envFile;
let local;

function fail(message) {
  throw new Error(`Acceptance runner: ${message}`);
}

function command(args, env = process.env) {
  const result = spawnSync(npx, args, { cwd: process.cwd(), encoding: 'utf8', env });
  if (result.status !== 0) fail(`${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function statusEnvironment() {
  const raw = command(['supabase', 'status', '-o', 'env']);
  return Object.fromEntries([...raw.matchAll(/^(\w+)="(.*)"$/gm)].map(([, key, value]) => [key, value]));
}

function assertLocal(value, name) {
  let url;
  try { url = new URL(value); } catch { fail(`${name} is not a URL`); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) fail(`${name} must target local infrastructure, got ${url.hostname}`);
}

async function cleanupUsers() {
  const response = await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: { Authorization: `Bearer ${local.SUPABASE_SERVICE_KEY}`, apikey: local.SUPABASE_SERVICE_KEY } });
  if (!response.ok) fail(`listing acceptance users failed with HTTP ${response.status}`);
  const body = await response.json();
  const users = Array.isArray(body.users) ? body.users : [];
  await Promise.all(users.filter((user) => user.email?.startsWith(acceptancePrefix)).map(async (user) => {
    const deletion = await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${local.SUPABASE_SERVICE_KEY}`, apikey: local.SUPABASE_SERVICE_KEY } });
    if (!deletion.ok && deletion.status !== 404) fail(`deleting stale acceptance user failed with HTTP ${deletion.status}`);
  }));
}

async function functionAlreadyServed() {
  const response = await fetch(`${local.SUPABASE_URL}/functions/v1/api/auth.session?input=${encodeURIComponent('{}')}`);
  // A correctly served API rejects this unauthenticated probe with 401. Kong
  // reports a stopped Edge Runtime as 503, which is safe for this runner to replace.
  return response.status === 401;
}

async function waitForFunction() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await functionAlreadyServed()) return;
    if (functionProcess.exitCode !== null) fail('the owned Edge Function process exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail('owned Edge Function was not ready within 30 seconds');
}

async function stopFunction() {
  if (functionProcess && functionProcess.exitCode === null) {
    functionProcess.kill('SIGTERM');
    await new Promise((resolve) => functionProcess.once('exit', resolve));
  }
  if (runtimeOwned) spawnSync(docker, ['stop', 'supabase_edge_runtime_flash-card'], { stdio: 'ignore' });
}

try {
  local = statusEnvironment();
  if (!local.API_URL || !local.DB_URL || !local.PUBLISHABLE_KEY || !local.SECRET_KEY) fail('Supabase status did not provide local API, database, and keys');
  assertLocal(local.API_URL, 'API_URL');
  assertLocal(local.DB_URL, 'DB_URL');
  local = { SUPABASE_URL: local.API_URL, DATABASE_URL: local.DB_URL, SUPABASE_ANON_KEY: local.PUBLISHABLE_KEY, SUPABASE_SERVICE_KEY: local.SECRET_KEY };

  if (await functionAlreadyServed()) fail('api is already being served; stop it so this run can inject its ephemeral test-clock secret');
  command(['drizzle-kit', 'migrate'], { ...process.env, DATABASE_URL: local.DATABASE_URL });
  await cleanupUsers();

  const clockSecret = randomBytes(32).toString('hex');
  envFile = join(tmpdir(), `flash-card-acceptance-${randomUUID()}.env`);
  const functionEnv = await readFile('supabase/functions/api/.env', 'utf8');
  await writeFile(envFile, `${functionEnv.trim()}\nFLASHCARD_TEST_CLOCK_SECRET=${clockSecret}\n`);
  runtimeOwned = true;
  functionProcess = spawn(npx, ['supabase', 'functions', 'serve', 'api', '--env-file', envFile], { cwd: process.cwd(), stdio: 'inherit', env: process.env });
  await waitForFunction();

  const vitest = spawn(npx, ['vitest', 'run', '--config', 'vitest.acceptance.config.ts'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, ...local, FLASHCARD_TEST_CLOCK_SECRET: clockSecret, FLASHCARD_ACCEPTANCE_RUN_ID: randomUUID() },
  });
  const exitCode = await new Promise((resolve) => vitest.once('exit', (code) => resolve(code ?? 1)));
  if (exitCode !== 0) process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try { await stopFunction(); } finally {
    if (local) await cleanupUsers().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
    if (envFile) await rm(envFile, { force: true });
  }
}
