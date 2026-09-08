import { randomBytes, randomUUID } from 'node:crypto';
import { cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const bin = (name) => join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const acceptanceWorkdir = 'acceptance';
const acceptanceSourceProjection = 'acceptance/src';
const acceptancePrefix = 'acceptance-';
let functionProcess;
let sourceProjectionOwned = false;
let functionSourceProjectionOwned = false;
let stackOwned = false;
let envFile;
let local;

function fail(message) { throw new Error(`Acceptance runner: ${message}`); }
function runTool(name, args, env = process.env) { return spawnSync(bin(name), args, { cwd: process.cwd(), encoding: 'utf8', env }); }
function runSupabase(args, env = process.env) { return runTool('supabase', [...args, '--workdir', acceptanceWorkdir], env); }
function command(args, env = process.env) {
  const result = runSupabase(args, env);
  if (result.status !== 0) fail(`${args.join(' ')} failed\n${result.stdout}${result.stderr}`);
  return result.stdout;
}
function statusEnvironment() { return Object.fromEntries([...command(['status', '-o', 'env']).matchAll(/^(\w+)="(.*)"$/gm)].map(([, key, value]) => [key, value])); }
function assertLocal(value, name) {
  let url;
  try { url = new URL(value); } catch { fail(`${name} is not a URL`); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) fail(`${name} must target local infrastructure, got ${url.hostname}`);
}
async function cleanupUsers() {
  const response = await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: { Authorization: `Bearer ${local.SUPABASE_SERVICE_KEY}`, apikey: local.SUPABASE_SERVICE_KEY } });
  if (!response.ok) fail(`listing acceptance users failed with HTTP ${response.status}`);
  const body = await response.json();
  await Promise.all((Array.isArray(body.users) ? body.users : []).filter((user) => user.email?.startsWith(acceptancePrefix)).map(async (user) => {
    const deletion = await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${local.SUPABASE_SERVICE_KEY}`, apikey: local.SUPABASE_SERVICE_KEY } });
    if (!deletion.ok && deletion.status !== 404) fail(`deleting stale acceptance user failed with HTTP ${deletion.status}`);
  }));
}
async function functionAlreadyServed() {
  const response = await fetch(`${local.SUPABASE_URL}/functions/v1/api/auth.session?input=${encodeURIComponent('{}')}`);
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
async function warmFunction() {
  const email = `${acceptancePrefix}warm-${randomUUID()}@example.com`;
  const password = `acceptance-${randomUUID()}`;
  const adminHeaders = { Authorization: `Bearer ${local.SUPABASE_SERVICE_KEY}`, apikey: local.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
  const created = await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!created.ok) fail(`creating function warmup user failed with HTTP ${created.status}`);
  const user = await created.json();
  const userId = user.id ?? user.user?.id;
  try {
    const signedIn = await fetch(`${local.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: local.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!signedIn.ok) fail(`signing in function warmup user failed with HTTP ${signedIn.status}`);
    const token = (await signedIn.json()).access_token;
    if (typeof token !== 'string') fail('function warmup sign-in returned no access token');
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${local.SUPABASE_URL}/functions/v1/api/auth.session?input=${encodeURIComponent('{}')}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 200) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    fail('owned Edge Function did not finish its authenticated warmup within 30 seconds');
  } finally { await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders }); }
}
async function stopFunction() {
  if (!functionProcess || functionProcess.exitCode !== null) return;
  functionProcess.kill('SIGTERM');
  await new Promise((resolve) => functionProcess.once('exit', resolve));
}
function startAcceptanceStack() {
  if (runSupabase(['status', '-o', 'env']).status === 0) fail('acceptance stack is already running; stop it so this run owns its environment');
  command(['start', '--exclude', 'edge-runtime']); stackOwned = true;
  const environment = statusEnvironment();
  if (!environment.API_URL || !environment.DB_URL || !environment.PUBLISHABLE_KEY || !environment.SECRET_KEY) fail('Supabase status did not provide local API, database, and keys');
  assertLocal(environment.API_URL, 'API_URL'); assertLocal(environment.DB_URL, 'DB_URL');
  return { SUPABASE_URL: environment.API_URL, DATABASE_URL: environment.DB_URL, SUPABASE_ANON_KEY: environment.PUBLISHABLE_KEY, SUPABASE_SERVICE_KEY: environment.SECRET_KEY };
}
function stopAcceptanceStack() {
  if (!stackOwned) return;
  const result = runSupabase(['stop', '--no-backup']);
  if (result.status !== 0) { console.error(`Acceptance runner: stopping isolated stack failed\n${result.stderr || result.stdout}`); process.exitCode = 1; }
}
async function materializeAcceptanceSource() {
  await rm(acceptanceSourceProjection, { recursive: true, force: true });
  await cp('src', acceptanceSourceProjection, { recursive: true });
  sourceProjectionOwned = true;
  const functionProjection = join(acceptanceWorkdir, 'supabase', 'functions');
  await rm(functionProjection, { recursive: true, force: true });
  await cp('supabase/functions', functionProjection, { recursive: true });
  functionSourceProjectionOwned = true;
}
async function runSuite(config, environment) {
  const vitest = spawn(bin('vitest'), ['run', '--config', config], { cwd: process.cwd(), stdio: 'inherit', env: environment });
  const exitCode = await new Promise((resolve) => vitest.once('exit', (code) => resolve(code ?? 1)));
  return exitCode;
}

try {
  await materializeAcceptanceSource();
  local = startAcceptanceStack();
  const drizzle = runTool('drizzle-kit', ['migrate'], { ...process.env, DATABASE_URL: local.DATABASE_URL });
  if (drizzle.status !== 0) fail(`drizzle-kit migrate failed\n${drizzle.stderr || drizzle.stdout}`);
  await cleanupUsers();
  const clockSecret = randomBytes(32).toString('hex');
  envFile = join(tmpdir(), `flash-card-acceptance-${randomUUID()}.env`);
  await writeFile(envFile, `DATABASE_URL=${local.DATABASE_URL}\nFLASHCARD_TEST_CLOCK_SECRET=${clockSecret}\n`);
  functionProcess = spawn(bin('supabase'), ['functions', 'serve', 'api', '--env-file', envFile, '--workdir', acceptanceWorkdir], { cwd: process.cwd(), stdio: 'inherit', env: process.env });
  await waitForFunction(); await warmFunction();
  const environment = { ...process.env, ...local, FLASHCARD_TEST_CLOCK_SECRET: clockSecret, FLASHCARD_ACCEPTANCE_RUN_ID: randomUUID() };
  await runSuite('vitest.acceptance.config.ts', environment);
} catch (error) {
  console.error(error instanceof Error ? error.message : error); process.exitCode = 1;
} finally {
  try { await stopFunction(); } finally {
    if (local) await cleanupUsers().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
    if (envFile) await rm(envFile, { force: true });
    stopAcceptanceStack();
    if (sourceProjectionOwned) await rm(acceptanceSourceProjection, { recursive: true, force: true });
  }
    if (functionSourceProjectionOwned) {
      await rm(join(acceptanceWorkdir, 'supabase', 'functions'), { recursive: true, force: true });
      await writeFile(join(acceptanceWorkdir, 'supabase', 'functions'), '../../supabase/functions');
    }
}
