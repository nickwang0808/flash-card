import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { getDb } from '../src/db/client.ts';
import { cardRouter } from '../supabase/functions/api/routers/card.ts';
import { deckRouter } from '../supabase/functions/api/routers/deck.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const email = 'nick@gmail.com';
const password = 'nick123';
const deckName = 'Spanish Numbers 1-100';
const batchSize = 10;

const spanishUnderThirty = [
  '',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

const englishUnderTwenty = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const spanishTens = new Map([
  [30, 'treinta'],
  [40, 'cuarenta'],
  [50, 'cincuenta'],
  [60, 'sesenta'],
  [70, 'setenta'],
  [80, 'ochenta'],
  [90, 'noventa'],
]);

const englishTens = new Map([
  [20, 'twenty'],
  [30, 'thirty'],
  [40, 'forty'],
  [50, 'fifty'],
  [60, 'sixty'],
  [70, 'seventy'],
  [80, 'eighty'],
  [90, 'ninety'],
]);

function spanish(number) {
  if (number < spanishUnderThirty.length) return spanishUnderThirty[number];
  if (number === 100) return 'cien';
  const tens = Math.floor(number / 10) * 10;
  const tensWord = spanishTens.get(tens);
  if (!tensWord) throw new Error(`No Spanish fixture for ${number}`);
  const units = number % 10;
  return units === 0 ? tensWord : `${tensWord} y ${spanishUnderThirty[units]}`;
}

function english(number) {
  if (number < englishUnderTwenty.length) return englishUnderTwenty[number];
  if (number === 100) return 'one hundred';
  const tens = Math.floor(number / 10) * 10;
  const tensWord = englishTens.get(tens);
  if (!tensWord) throw new Error(`No English fixture for ${number}`);
  const units = number % 10;
  return units === 0 ? tensWord : `${tensWord}-${englishUnderTwenty[units]}`;
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Supabase status did not provide ${name}`);
  return value;
}

function assertLoopback(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error(`${name} must target local infrastructure; received ${url.hostname}`);
  }
}

function localEnvironment() {
  let output;
  try {
    output = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? `\n${error.stderr.trim()}` : '';
    throw new Error(`The local Supabase stack must already be running.${detail}`);
  }

  let environment;
  try {
    environment = JSON.parse(output);
  } catch {
    throw new Error('Supabase status returned invalid JSON');
  }

  const apiUrl = required(environment, 'API_URL');
  const databaseUrl = required(environment, 'DB_URL');
  const publishableKey = environment.PUBLISHABLE_KEY ?? required(environment, 'ANON_KEY');
  const secretKey = environment.SECRET_KEY ?? required(environment, 'SERVICE_ROLE_KEY');
  assertLoopback(apiUrl, 'API_URL');
  assertLoopback(databaseUrl, 'DB_URL');
  return { apiUrl, databaseUrl, publishableKey, secretKey };
}

function cardFixtures() {
  return Array.from({ length: 100 }, (_, index) => {
    const number = index + 1;
    return {
      name: String(number),
      frontMarkdown: spanish(number),
      backMarkdown: english(number),
      tags: ['numbers', 'spanish', 'english'],
      speechText: null,
      speechLocale: null,
      reversible: true,
    };
  });
}

async function seed() {
  const environment = localEnvironment();
  const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = createClient(environment.apiUrl, environment.secretKey, authOptions);
  const publicClient = createClient(environment.apiUrl, environment.publishableKey, authOptions);
  const fixtures = cardFixtures();
  let createdUserId;
  let db;

  try {
    const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (listError) throw listError;
    if (existingUsers.users.length !== 0) {
      throw new Error('The local database is not empty; refusing to overwrite existing users');
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;
    if (!created.user) throw new Error('Supabase Auth created no user');
    createdUserId = created.user.id;

    const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    if (signedIn.user.id !== createdUserId) throw new Error('Seeded credentials authenticated as the wrong user');

    db = getDb(environment.databaseUrl);
    const context = {
      identity: { userId: createdUserId, email, issuedAt: null, expiresAt: null },
      db,
      now: new Date(),
    };
    const decks = deckRouter.createCaller(context);
    const cards = cardRouter.createCaller(context);
    const deck = await decks.create({ name: deckName, defaultSpeechLocale: null });

    for (let offset = 0; offset < fixtures.length; offset += batchSize) {
      const batch = fixtures.slice(offset, offset + batchSize);
      const results = await Promise.allSettled(batch.map((fixture) => cards.create({ deckId: deck.id, ...fixture })));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    }

    const deckList = await decks.list({});
    const search = await cards.search({ deckId: deck.id, query: 'numbers', pagination: { limit: 100 } });
    const names = new Set(search.cards.map((card) => card.name));
    const validDirections = search.cards.every((card) => card.cadences.map((cadence) => cadence.direction).sort().join(',') === 'forward,reverse');

    if (deckList.decks.length !== 1 || deckList.decks[0].id !== deck.id) throw new Error('Seed verification found an unexpected deck');
    if (search.cards.length !== 100 || search.pageInfo.nextCursor !== null) throw new Error(`Seed verification found ${search.cards.length} cards instead of 100`);
    if (fixtures.some((fixture) => !names.has(fixture.name))) throw new Error('Seed verification found missing card names');
    if (!search.cards.every((card) => card.reversible) || !validDirections) throw new Error('Seed verification found an invalid reversible card');

    console.log(`Seeded ${deckName}: 100 reversible cards and 200 cadences`);
    console.log(`Sign in with ${email} / ${password}`);
  } catch (error) {
    if (createdUserId) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) console.error(`Failed to remove partial seed user: ${cleanupError.message}`);
    }
    throw error;
  } finally {
    if (db) await db.$client.end();
  }
}

try {
  await seed();
} catch (error) {
  console.error(error instanceof Error ? `Local seed failed: ${error.message}` : error);
  process.exitCode = 1;
}
