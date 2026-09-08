import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

const outfile = 'dist-cli/flashcard.mjs';
await build({
  entryPoints: ['src/cli/main.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  external: ['@napi-rs/keyring'],
});
await chmod(outfile, 0o755);
