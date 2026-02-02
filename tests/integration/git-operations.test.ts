import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = path.resolve(__dirname, '../../temp');
const BARE_REPO = path.join(TEMP_DIR, 'test-repo.git');
const WORK_REPO = path.join(TEMP_DIR, 'test-work');

const testCardsJson = JSON.stringify({
  hola: {
    id: 'hola',
    source: 'hola',
    translation: 'hello',
    created: '2025-01-01T00:00:00Z',
  },
}, null, 2);

describe('Git operations (integration)', () => {
  beforeAll(() => {
    // Create temp dir and bare repo
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    if (fs.existsSync(BARE_REPO)) fs.rmSync(BARE_REPO, { recursive: true });
    if (fs.existsSync(WORK_REPO)) fs.rmSync(WORK_REPO, { recursive: true });

    // Init bare repo
    execSync(`git init --bare "${BARE_REPO}"`);

    // Clone, add content, push
    execSync(`git clone "${BARE_REPO}" "${WORK_REPO}"`);
    const deckDir = path.join(WORK_REPO, 'spanish-vocab');
    fs.mkdirSync(deckDir);
    fs.writeFileSync(path.join(deckDir, 'cards.json'), testCardsJson);
    fs.writeFileSync(path.join(deckDir, 'state.json'), '{}');

    execSync('git add .', { cwd: WORK_REPO });
    execSync('git commit -m "seed test data"', { cwd: WORK_REPO });
    execSync('git push', { cwd: WORK_REPO });
  });

  afterAll(() => {
    if (fs.existsSync(BARE_REPO)) fs.rmSync(BARE_REPO, { recursive: true });
    if (fs.existsSync(WORK_REPO)) fs.rmSync(WORK_REPO, { recursive: true });
  });

  it('bare repo was created and seeded', () => {
    expect(fs.existsSync(BARE_REPO)).toBe(true);
    const result = execSync(`git log --oneline`, { cwd: WORK_REPO }).toString();
    expect(result).toContain('seed test data');
  });

  it('can clone and read deck data', () => {
    const cloneDir = path.join(TEMP_DIR, 'test-clone');
    if (fs.existsSync(cloneDir)) fs.rmSync(cloneDir, { recursive: true });

    execSync(`git clone "${BARE_REPO}" "${cloneDir}"`);
    const cards = JSON.parse(
      fs.readFileSync(path.join(cloneDir, 'spanish-vocab', 'cards.json'), 'utf-8'),
    );
    expect(cards.hola.translation).toBe('hello');

    fs.rmSync(cloneDir, { recursive: true });
  });

  it('can commit and push changes', () => {
    const stateData = JSON.stringify({ hola: { reps: 1 } });
    fs.writeFileSync(path.join(WORK_REPO, 'spanish-vocab', 'state.json'), stateData);

    execSync('git add .', { cwd: WORK_REPO });
    execSync('git commit -m "update state"', { cwd: WORK_REPO });
    execSync('git push', { cwd: WORK_REPO });

    // Verify in a fresh clone
    const verifyDir = path.join(TEMP_DIR, 'test-verify');
    if (fs.existsSync(verifyDir)) fs.rmSync(verifyDir, { recursive: true });
    execSync(`git clone "${BARE_REPO}" "${verifyDir}"`);

    const state = JSON.parse(
      fs.readFileSync(path.join(verifyDir, 'spanish-vocab', 'state.json'), 'utf-8'),
    );
    expect(state.hola.reps).toBe(1);

    fs.rmSync(verifyDir, { recursive: true });
  });
});
