/**
 * Test seeding utility. Exposes functions on `window.__TEST__` for e2e tests
 * to seed data into the browser's LightningFS without needing a real remote.
 */
import git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';

const DIR = '/repo';

export interface SeedCards {
  [id: string]: {
    id: string;
    source: string;
    translation: string;
    example?: string;
    notes?: string;
    tags?: string[];
    created: string;
    reversible?: boolean;
  };
}

async function rmrf(fs: LightningFS, path: string) {
  try {
    const stat = await fs.promises.stat(path);
    if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(path);
      for (const entry of entries) {
        await rmrf(fs, `${path}/${entry}`);
      }
      await fs.promises.rmdir(path);
    } else {
      await fs.promises.unlink(path);
    }
  } catch {
    // doesn't exist, that's fine
  }
}

export async function seedTestRepo(cards: SeedCards): Promise<void> {
  const fs = new LightningFS('flash-card-fs');

  // Remove existing repo dir if present
  await rmrf(fs, DIR);

  await fs.promises.mkdir(DIR, { recursive: true } as any);
  await git.init({ fs, dir: DIR, defaultBranch: 'main' });
  await fs.promises.mkdir(`${DIR}/spanish-vocab`);

  await fs.promises.writeFile(
    `${DIR}/spanish-vocab/cards.json`,
    JSON.stringify(cards, null, 2),
    'utf8',
  );
  await fs.promises.writeFile(`${DIR}/spanish-vocab/state.json`, '{}', 'utf8');

  await git.add({ fs, dir: DIR, filepath: 'spanish-vocab/cards.json' });
  await git.add({ fs, dir: DIR, filepath: 'spanish-vocab/state.json' });
  await git.commit({
    fs,
    dir: DIR,
    message: 'seed test data',
    author: { name: 'Test', email: 'test@test.com' },
  });
}

export async function getTestGitLog(): Promise<Array<{ message: string; oid: string }>> {
  const fs = new LightningFS('flash-card-fs');
  const commits = await git.log({ fs, dir: DIR, depth: 20 });
  return commits.map((c) => ({
    message: c.commit.message.trim(),
    oid: c.oid.slice(0, 7),
  }));
}

export async function getTestStateJson(deckName: string): Promise<Record<string, any>> {
  const fs = new LightningFS('flash-card-fs');
  const content = await fs.promises.readFile(`${DIR}/${deckName}/state.json`, 'utf8');
  return JSON.parse(content as string);
}

// Expose on window for e2e tests
(window as any).__TEST__ = {
  seedTestRepo,
  getTestGitLog,
  getTestStateJson,
};
