import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runCli } from './run.ts';

function stdin(input = ''): PassThrough {
  const value = new PassThrough();
  value.end(input);
  return value;
}

function captured(): { stream: Writable; text: () => string } {
  let value = '';
  return { stream: new Writable({ write(chunk, _encoding, callback) { value += Buffer.from(chunk).toString('utf8'); callback(); } }), text: () => value };
}

describe('runCli', () => {
  it('keeps conventional version output independent from configuration', async () => {
    const stdout = captured();
    const stderr = captured();
    const status = await runCli(['--version'], { stdin: stdin(), stdout: stdout.stream, stderr: stderr.stream, environment: {} });
    expect(status).toBe(0);
    expect(stdout.text()).toBe('0.1.0\n');
    expect(stderr.text()).toBe('');
  });

  it('writes one structured configuration failure to stderr only', async () => {
    const stdout = captured();
    const stderr = captured();
    const status = await runCli(['auth', 'session'], { stdin: stdin(), stdout: stdout.stream, stderr: stderr.stream, environment: {} });
    expect(status).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toEqual({ ok: false, error: { code: 'CONFIGURATION_ERROR', message: 'CLI environment is incomplete or invalid' } });
  });

  it('rejects malformed arguments without Commander diagnostics', async () => {
    const stdout = captured();
    const stderr = captured();
    const status = await runCli(['deck', 'create', '--unknown'], { stdin: stdin(), stdout: stdout.stream, stderr: stderr.stream, environment: {} });
    expect(status).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toEqual({ ok: false, error: { code: 'USAGE_ERROR', message: 'Invalid command usage' } });
  });
});
