import { mkdtemp, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCredentialStore, profileIdFor } from './credentials.ts';

const session = { version: 1 as const, accessToken: 'access', refreshToken: 'refresh' };

describe('FileCredentialStore', () => {
  it('writes and removes a versioned private session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flashcard-cli-'));
    const store = new FileCredentialStore(root, 'profile');
    await store.write(session);
    expect(await store.read()).toEqual(session);
    expect(await store.delete()).toBe(true);
    expect(await store.read()).toBeNull();
  });

  it('rejects insecure credential files on POSIX', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'flashcard-cli-'));
    const store = new FileCredentialStore(root, 'profile');
    await store.write(session);
    await chmod(store.path, 0o644);
    await expect(store.read()).rejects.toThrow('insecure permissions');
  });

  it('derives distinct stable profiles for distinct origins', () => {
    expect(profileIdFor('https://example.com')).toBe(profileIdFor('https://example.com/'));
    expect(profileIdFor('https://example.com')).not.toBe(profileIdFor('https://other.example.com'));
  });
});
