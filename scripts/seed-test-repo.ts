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
const SEED_CARDS = {
  hola: {
    source: 'hola',
    translation: 'hello',
    example: '¡Hola! ¿Cómo estás?',
    created: '2024-01-01T00:00:00Z',
    state: null,
    reverseState: null,
  },
  gracias: {
    source: 'gracias',
    translation: 'thank you',
    example: 'Muchas gracias por tu ayuda.',
    created: '2024-01-01T00:00:00Z',
    state: null,
    reverseState: null,
  },
  agua: {
    source: 'agua',
    translation: 'water',
    example: 'Necesito un vaso de agua.',
    created: '2024-01-01T00:00:00Z',
    state: null,
    reverseState: null,
  },
  gato: {
    source: 'gato',
    translation: 'cat',
    notes: 'Common pet',
    created: '2024-01-01T00:00:00Z',
    reversible: true,
    state: null,
    reverseState: null,
  },
  perro: {
    source: 'perro',
    translation: 'dog',
    notes: 'Common pet',
    created: '2024-01-01T00:00:00Z',
    state: null,
    reverseState: null,
  },
};

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

  console.log('\n✓ Seed complete! 5 cards + 1 reversible (6 total reviewable)');
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
