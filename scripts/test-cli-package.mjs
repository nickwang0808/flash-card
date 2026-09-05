import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'flashcard-package-'));
try {
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const [{ filename, files }] = JSON.parse(packed.stdout);
  const names = files.map((file) => file.path);
  for (const required of ['dist-cli/flashcard.mjs', 'README.md', 'docs/cli.md', 'package.json']) if (!names.includes(required)) throw new Error(`Tarball omitted ${required}`);
  const init = spawnSync('npm', ['init', '-y'], { cwd: temporary, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const installed = spawnSync('npm', ['install', join(temporary, filename)], { cwd: temporary, encoding: 'utf8' });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);
  const binary = process.platform === 'win32' ? join(temporary, 'node_modules', '.bin', 'flashcard.cmd') : join(temporary, 'node_modules', '.bin', 'flashcard');
  const keyring = spawnSync(process.execPath, ['--input-type=module', '--eval', 'await import("@napi-rs/keyring")'], { cwd: temporary, encoding: 'utf8' });
  if (keyring.status !== 0) throw new Error(`Installed keyring binding failed to load: ${keyring.stderr}`);
  for (const args of [['--version'], ['--help']]) {
    const result = spawnSync(binary, args, { cwd: temporary, encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout || result.stderr) throw new Error(`Executable ${args.join(' ')} failed`);
  }
  const failure = spawnSync(binary, ['auth', 'session'], { cwd: temporary, encoding: 'utf8', env: { PATH: process.env.PATH, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) } });
  if (failure.status !== 1 || failure.stdout || failure.stderr.trim() !== JSON.stringify({ ok: false, error: { code: 'CONFIGURATION_ERROR', message: 'CLI environment is incomplete or invalid' } })) throw new Error('Configuration failure contract changed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
