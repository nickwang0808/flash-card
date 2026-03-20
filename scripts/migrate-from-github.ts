/**
 * One-time migration: GitHub repo cards.json → Supabase Postgres
 *
 * Usage:
 *   npx tsx scripts/migrate-from-github.ts <userId> <github-repo-url>
 *
 * Example:
 *   npx tsx scripts/migrate-from-github.ts abc-123 https://github.com/nickwang0808/flash-card-data
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars (service key bypasses RLS).
 */
import { createClient } from '@supabase/supabase-js';

const userId = process.argv[2];
const repoUrl = process.argv[3];

if (!userId || !repoUrl) {
  console.error('Usage: npx tsx scripts/migrate-from-github.ts <userId> <github-repo-url>');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
if (!supabaseKey) {
  console.error('Set SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY for local) env var');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse github URL → API URL
const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
if (!match) { console.error('Invalid GitHub URL'); process.exit(1); }
const [, owner, repo] = match;

interface CardJSON {
  front?: string;
  back: string;
  tags?: string[];
  created: string;
  reversible?: boolean;
  state: Record<string, unknown> | null;
  reverseState: Record<string, unknown> | null;
  suspended?: boolean;
}

async function fetchDeck(deckName: string): Promise<Record<string, CardJSON>> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${deckName}/cards.json`,
    { headers: { Accept: 'application/vnd.github.v3.raw' } },
  );
  if (!res.ok) throw new Error(`Failed to fetch ${deckName}: ${res.status}`);
  return res.json();
}

async function migrate() {
  // List decks
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/`);
  const entries = await res.json() as Array<{ name: string; type: string }>;
  const decks = entries.filter(e => e.type === 'dir' && !e.name.startsWith('.'));

  console.log(`Found ${decks.length} deck(s): ${decks.map(d => d.name).join(', ')}`);

  for (const deck of decks) {
    const deckName = deck.name;
    console.log(`\nMigrating deck: ${deckName}`);

    const cardsJson = await fetchDeck(deckName);
    const terms = Object.keys(cardsJson).filter(k => !k.startsWith('$'));
    console.log(`  ${terms.length} cards`);

    // Build card rows
    const cardRows = terms.map((term, index) => {
      const card = cardsJson[term];
      return {
        id: `${deckName}::${term}`,
        userId,
        deckName,
        term,
        front: card.front ?? null,
        back: card.back,
        tags: JSON.stringify(card.tags ?? []),
        created: card.created,
        reversible: card.reversible ?? false,
        order: index,
        suspended: card.suspended ?? false,
        approved: true,
      };
    });

    // Build srs_state rows
    const srsRows: Array<Record<string, unknown>> = [];
    for (const term of terms) {
      const card = cardsJson[term];
      const cardId = `${deckName}::${term}`;

      if (card.state) {
        srsRows.push({
          id: `${cardId}:forward`,
          userId,
          cardId,
          direction: 'forward',
          due: card.state.due as string,
          stability: card.state.stability,
          difficulty: card.state.difficulty,
          elapsedDays: card.state.elapsed_days,
          scheduledDays: card.state.scheduled_days,
          reps: card.state.reps,
          lapses: card.state.lapses,
          state: card.state.state,
          lastReview: card.state.last_review as string | undefined,
        });
      }

      if (card.reverseState) {
        srsRows.push({
          id: `${cardId}:reverse`,
          userId,
          cardId,
          direction: 'reverse',
          due: card.reverseState.due as string,
          stability: card.reverseState.stability,
          difficulty: card.reverseState.difficulty,
          elapsedDays: card.reverseState.elapsed_days,
          scheduledDays: card.reverseState.scheduled_days,
          reps: card.reverseState.reps,
          lapses: card.reverseState.lapses,
          state: card.reverseState.state,
          lastReview: card.reverseState.last_review as string | undefined,
        });
      }
    }

    console.log(`  ${srsRows.length} SRS state rows`);

    // Upsert cards
    const { error: cardsError } = await supabase
      .from('cards')
      .upsert(cardRows, { onConflict: 'id' });
    if (cardsError) {
      console.error('  Cards insert failed:', cardsError.message);
      continue;
    }
    console.log(`  ✓ ${cardRows.length} cards inserted`);

    // Upsert SRS state
    if (srsRows.length > 0) {
      const { error: srsError } = await supabase
        .from('srs_state')
        .upsert(srsRows, { onConflict: 'id' });
      if (srsError) {
        console.error('  SRS state insert failed:', srsError.message);
        continue;
      }
      console.log(`  ✓ ${srsRows.length} SRS state rows inserted`);
    }
  }

  console.log('\nDone!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
