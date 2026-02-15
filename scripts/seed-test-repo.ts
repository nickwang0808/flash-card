#!/usr/bin/env npx tsx
/**
 * Seed and reset the test repo for development/testing.
 * Uses the same card data as E2E tests — one dataset to maintain.
 *
 * Usage:
 *   npx tsx scripts/seed-test-repo.ts seed    # Seed with test data
 *   npx tsx scripts/seed-test-repo.ts reset   # Reset to clean state (no FSRS state)
 *   npx tsx scripts/seed-test-repo.ts status  # Show current state
 */

import { Octokit } from '@octokit/rest';
import * as dotenv from 'dotenv';
import { TEST_CARDS } from '../tests/e2e/test-server';

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
  console.log(`${sha ? 'Updated' : 'Created'} ${path}`);
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
  console.log(`Deleted ${path}`);
  return true;
}

async function seed(): Promise<void> {
  console.log(`\nSeeding ${REPO_URL}...\n`);

  await writeFile(
    'spanish-vocab/cards.json',
    JSON.stringify(TEST_CARDS, null, 2),
    'seed test data'
  );

  // Delete old state.json if it exists (legacy cleanup)
  await deleteFile('spanish-vocab/state.json', 'cleanup: remove legacy state.json');

  const cardCount = Object.keys(TEST_CARDS).length;
  const reversibleCount = Object.values(TEST_CARDS).filter((c: any) => c.reversible).length;
  console.log(`\nSeed complete! ${cardCount} cards (${reversibleCount} reversible, ${cardCount + reversibleCount} total reviewable)`);
}

async function reset(): Promise<void> {
  console.log(`\nResetting ${REPO_URL}...\n`);

  await writeFile(
    'spanish-vocab/cards.json',
    JSON.stringify(TEST_CARDS, null, 2),
    'reset: restore seed data (all cards new)'
  );

  // Delete old state.json if it exists (legacy cleanup)
  await deleteFile('spanish-vocab/state.json', 'cleanup: remove legacy state.json');

  console.log('\nReset complete! All cards are now new again.');
}

async function status(): Promise<void> {
  console.log(`\nStatus of ${REPO_URL}:\n`);

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: 'spanish-vocab/cards.json',
    });
    if (!Array.isArray(data) && 'content' in data) {
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      const cards = JSON.parse(content);
      const entries = Object.entries(cards) as [string, any][];
      const reviewed = entries.filter(([, c]) => c.state).length;
      const newCards = entries.filter(([, c]) => !c.state).length;

      console.log(`Cards: ${entries.length} cards in spanish-vocab/cards.json`);
      console.log(`  - ${newCards} new, ${reviewed} reviewed`);

      for (const [term, card] of entries) {
        if (card.state) {
          console.log(`  - ${term}: ${card.state.reps} reps, due ${card.state.due?.split('T')[0] || 'unknown'}`);
        } else {
          console.log(`  - ${term}: new${card.reversible ? ' (reversible)' : ''}`);
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
