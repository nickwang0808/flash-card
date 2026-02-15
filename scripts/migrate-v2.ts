#!/usr/bin/env npx tsx
/**
 * Migration script: v1 (source/translation/example/notes) → v2 (front/back markdown)
 *
 * Converts old-format cards.json files in a data repository to the new format.
 * The key (term) stays the same. `source` field is removed (redundant with key).
 * `translation`, `example`, and `notes` are combined into `back` as markdown.
 * `front` is omitted (defaults to the key).
 *
 * Usage:
 *   npx tsx scripts/migrate-v2.ts <path-to-data-repo>
 *
 * Example:
 *   npx tsx scripts/migrate-v2.ts ../my-flashcard-data
 */

import * as fs from 'fs';
import * as path from 'path';

interface OldCardJSON {
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
  state: Record<string, unknown> | null;
  reverseState: Record<string, unknown> | null;
  suspended?: boolean;
}

interface NewCardJSON {
  front?: string;
  back: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
  state: Record<string, unknown> | null;
  reverseState: Record<string, unknown> | null;
  suspended?: boolean;
}

function migrateBack(translation: string, example?: string, notes?: string): string {
  let back = translation;
  if (example) {
    back += `\n\n*${example}*`;
  }
  if (notes) {
    back += `\n\n> ${notes}`;
  }
  return back;
}

function migrateFile(filePath: string): { migrated: number; skipped: number } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const oldCards: Record<string, OldCardJSON> = JSON.parse(content);

  const newCards: Record<string, NewCardJSON> = {};
  let migrated = 0;
  let skipped = 0;

  for (const [key, card] of Object.entries(oldCards)) {
    // Check if already in new format (has 'back' field, no 'translation')
    if ('back' in card && !('translation' in card)) {
      newCards[key] = card as unknown as NewCardJSON;
      skipped++;
      continue;
    }

    const newCard: NewCardJSON = {
      back: migrateBack(card.translation, card.example, card.notes),
      created: card.created,
      state: card.state,
      reverseState: card.reverseState,
    };

    if (card.tags && card.tags.length > 0) newCard.tags = card.tags;
    if (card.reversible) newCard.reversible = card.reversible;
    if (card.suspended) newCard.suspended = card.suspended;

    newCards[key] = newCard;
    migrated++;
  }

  fs.writeFileSync(filePath, JSON.stringify(newCards, null, 2) + '\n', 'utf-8');
  return { migrated, skipped };
}

// --- Main ---

const dataRepoPath = process.argv[2];

if (!dataRepoPath) {
  console.error('Usage: npx tsx scripts/migrate-v2.ts <path-to-data-repo>');
  process.exit(1);
}

const resolvedPath = path.resolve(dataRepoPath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: Path does not exist: ${resolvedPath}`);
  process.exit(1);
}

const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
let totalMigrated = 0;
let totalSkipped = 0;

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

  const cardsFile = path.join(resolvedPath, entry.name, 'cards.json');
  if (!fs.existsSync(cardsFile)) continue;

  console.log(`Migrating ${entry.name}/cards.json...`);
  const { migrated, skipped } = migrateFile(cardsFile);
  console.log(`  ${migrated} migrated, ${skipped} already in new format`);
  totalMigrated += migrated;
  totalSkipped += skipped;
}

console.log(`\nDone! ${totalMigrated} cards migrated, ${totalSkipped} skipped.`);
