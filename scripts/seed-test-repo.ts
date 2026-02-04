#!/usr/bin/env npx tsx
/**
 * Seed and reset the test repo for development/testing.
 *
 * Usage:
 *   npx tsx scripts/seed-test-repo.ts seed    # Seed with test data
 *   npx tsx scripts/seed-test-repo.ts reset   # Reset to clean state (no FSRS state)
 *   npx tsx scripts/seed-test-repo.ts status  # Show current state
 */

import { Octokit } from '@octokit/rest';
import * as dotenv from 'dotenv';

dotenv.config();

const REPO_URL = process.env.E2E_REPO_URL || 'https://github.com/nickwang0808/flash-card-test';
const TOKEN = process.env.E2E_TOKEN || '';

if (!TOKEN) {
  console.error('Error: E2E_TOKEN environment variable is required');
  process.exit(1);
}

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2] };
}

const { owner, repo } = parseRepoUrl(REPO_URL);
const octokit = new Octokit({ auth: TOKEN });

// FlashCard schema - matches FlashCardJSON in github-service.ts
// Cards with state: null are "new" cards
const SEED_CARDS: Record<string, any> = {};

const VOCAB_DATA = [
  { source: 'hola', translation: 'hello', example: '¡Hola! ¿Cómo estás?' },
  { source: 'gracias', translation: 'thank you', example: 'Muchas gracias por tu ayuda.' },
  { source: 'agua', translation: 'water', example: 'Necesito un vaso de agua.' },
  { source: 'gato', translation: 'cat', notes: 'Common pet', reversible: true },
  { source: 'perro', translation: 'dog', notes: 'Common pet' },
  { source: 'casa', translation: 'house', example: 'Mi casa es grande.' },
  { source: 'libro', translation: 'book', example: 'Estoy leyendo un libro.' },
  { source: 'comida', translation: 'food', example: 'La comida está deliciosa.' },
  { source: 'tiempo', translation: 'time/weather', example: '¿Qué tiempo hace hoy?' },
  { source: 'amigo', translation: 'friend', example: 'Él es mi mejor amigo.', reversible: true },
  { source: 'trabajo', translation: 'work', example: 'Voy al trabajo cada día.' },
  { source: 'dinero', translation: 'money', example: 'No tengo mucho dinero.' },
  { source: 'ciudad', translation: 'city', example: 'Madrid es una ciudad bonita.' },
  { source: 'coche', translation: 'car', example: 'Mi coche es rojo.' },
  { source: 'mesa', translation: 'table', example: 'El libro está en la mesa.' },
  { source: 'silla', translation: 'chair', example: 'Siéntate en la silla.' },
  { source: 'ventana', translation: 'window', example: 'Abre la ventana, por favor.' },
  { source: 'puerta', translation: 'door', example: 'Cierra la puerta.' },
  { source: 'calle', translation: 'street', example: 'Vivo en esta calle.' },
  { source: 'mañana', translation: 'morning/tomorrow', example: 'Nos vemos mañana.' },
  { source: 'noche', translation: 'night', example: 'Buenas noches.' },
  { source: 'día', translation: 'day', example: '¿Qué día es hoy?' },
  { source: 'año', translation: 'year', example: 'El año tiene doce meses.' },
  { source: 'mes', translation: 'month', example: 'Este mes es enero.' },
  { source: 'semana', translation: 'week', example: 'La semana tiene siete días.' },
  { source: 'hora', translation: 'hour', example: '¿Qué hora es?' },
  { source: 'minuto', translation: 'minute', example: 'Espera un minuto.' },
  { source: 'segundo', translation: 'second', example: 'Vuelvo en un segundo.' },
  { source: 'nombre', translation: 'name', example: '¿Cuál es tu nombre?', reversible: true },
  { source: 'familia', translation: 'family', example: 'Mi familia es pequeña.' },
];

// Generate SEED_CARDS from VOCAB_DATA
for (const item of VOCAB_DATA) {
  SEED_CARDS[item.source] = {
    source: item.source,
    translation: item.translation,
    example: item.example,
    notes: item.notes,
    created: '2024-01-01T00:00:00Z',
    reversible: item.reversible ?? false,
    state: null,
    reverseState: null,
  };
}

async function getFileSha(path: string): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if (!Array.isArray(data) && 'sha' in data) {
      return data.sha;
    }
  } catch {
    // File doesn't exist
  }
  return null;
}

async function writeFile(path: string, content: string, message: string): Promise<void> {
  const sha = await getFileSha(path);
  const encoded = Buffer.from(content).toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: encoded,
    ...(sha ? { sha } : {}),
  });
  console.log(`✓ ${sha ? 'Updated' : 'Created'} ${path}`);
}

async function deleteFile(path: string, message: string): Promise<boolean> {
  const sha = await getFileSha(path);
  if (!sha) {
    console.log(`- ${path} doesn't exist, skipping`);
    return false;
  }

  await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha,
  });
  console.log(`✓ Deleted ${path}`);
  return true;
}

async function seed(): Promise<void> {
  console.log(`\nSeeding ${REPO_URL}...\n`);

  // Write cards.json (state is embedded per-card, undefined = new)
  await writeFile(
    'spanish-vocab/cards.json',
    JSON.stringify(SEED_CARDS, null, 2),
    'seed test data'
  );

  // Delete old state.json if it exists (legacy cleanup)
  await deleteFile('spanish-vocab/state.json', 'cleanup: remove legacy state.json');

  const reversibleCount = VOCAB_DATA.filter(v => v.reversible).length;
  console.log(`\n✓ Seed complete! ${VOCAB_DATA.length} cards (${reversibleCount} reversible, ${VOCAB_DATA.length + reversibleCount} total reviewable)`);
}

async function reset(): Promise<void> {
  console.log(`\nResetting ${REPO_URL}...\n`);

  // Re-seed cards without any FSRS state (all new)
  await writeFile(
    'spanish-vocab/cards.json',
    JSON.stringify(SEED_CARDS, null, 2),
    'reset: restore seed data (all cards new)'
  );

  // Delete old state.json if it exists (legacy cleanup)
  await deleteFile('spanish-vocab/state.json', 'cleanup: remove legacy state.json');

  console.log('\n✓ Reset complete! All cards are now new again.');
}

async function status(): Promise<void> {
  console.log(`\nStatus of ${REPO_URL}:\n`);

  // Check cards.json
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: 'spanish-vocab/cards.json',
    });
    if (!Array.isArray(data) && 'content' in data) {
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      const cards = JSON.parse(content);
      const cardList = Object.values(cards) as any[];
      const reviewed = cardList.filter((c) => c.state).length;
      const newCards = cardList.filter((c) => !c.state).length;

      console.log(`Cards: ${cardList.length} cards in spanish-vocab/cards.json`);
      console.log(`  - ${newCards} new, ${reviewed} reviewed`);

      for (const card of cardList) {
        if (card.state) {
          console.log(`  - ${card.source}: ${card.state.reps} reps, due ${card.state.due?.split('T')[0] || 'unknown'}`);
        } else {
          console.log(`  - ${card.source}: new${card.reversible ? ' (reversible)' : ''}`);
        }
      }
    }
  } catch {
    console.log('Cards: spanish-vocab/cards.json not found');
  }

  // Show recent commits
  console.log('\nRecent commits:');
  const { data: commits } = await octokit.repos.listCommits({
    owner,
    repo,
    per_page: 5,
  });
  for (const commit of commits) {
    const date = new Date(commit.commit.committer?.date || '').toLocaleDateString();
    console.log(`  - ${commit.sha.slice(0, 7)} ${date}: ${commit.commit.message.split('\n')[0]}`);
  }
}

// Main
const command = process.argv[2];

switch (command) {
  case 'seed':
    seed().catch(console.error);
    break;
  case 'reset':
    reset().catch(console.error);
    break;
  case 'status':
    status().catch(console.error);
    break;
  default:
    console.log(`
Usage:
  npx tsx scripts/seed-test-repo.ts seed    # Seed with test data
  npx tsx scripts/seed-test-repo.ts reset   # Reset to clean state
  npx tsx scripts/seed-test-repo.ts status  # Show current state
`);
}
