import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { AsyncEntry } from '@napi-rs/keyring';

type KeyringModule = { AsyncEntry: typeof AsyncEntry };
export type CredentialStoreKind = 'keyring' | 'file';


export interface StoredSession {
  version: 1;
  accessToken: string;
  refreshToken: string;
}

export interface CredentialStore {
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  delete(): Promise<boolean>;
}

class CredentialStoreError extends Error {
  constructor(readonly code: 'CREDENTIAL_STORE_UNAVAILABLE' | 'CREDENTIAL_STORE_ERROR', message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

export function profileIdFor(supabaseUrl: string): string {
  return createHash('sha256').update(new URL(supabaseUrl).href).digest('hex');
}

export function configRoot(environment: NodeJS.ProcessEnv = process.env, system = platform()): string {
  if (system === 'win32') return join(environment.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'flashcard');
  if (system === 'darwin') return join(homedir(), 'Library', 'Application Support', 'flashcard');
  return join(environment.XDG_CONFIG_HOME || join(environment.HOME || homedir(), '.config'), 'flashcard');
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Record<string, unknown>;
  return session.version === 1
    && typeof session.accessToken === 'string' && session.accessToken.length > 0
    && typeof session.refreshToken === 'string' && session.refreshToken.length > 0;
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (platform() !== 'win32') {
    const details = await stat(path);
    if ((details.mode & 0o077) !== 0) throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Credential directory has insecure permissions');
  }
}

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Credential storage must not be a symbolic link');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

async function readSecureFile(path: string): Promise<string | null> {
  await rejectSymlink(path);
  try {
    const details = await stat(path);
    if (platform() !== 'win32' && (details.mode & 0o077) !== 0) throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Credential file has insecure permissions');
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeSecureFile(path: string, content: string): Promise<void> {
  await ensureDirectory(dirname(path));
  await rejectSymlink(path);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await rename(temporary, path);
}

export class FileCredentialStore implements CredentialStore {
  readonly path: string;

  constructor(root: string, readonly profileId: string) {
    this.path = join(root, 'sessions', `${profileId}.json`);
  }

  async read(): Promise<StoredSession | null> {
    const raw = await readSecureFile(this.path);
    if (raw === null) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Credential file is corrupt'); }
    if (!isStoredSession(parsed)) throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Credential file is invalid');
    return parsed;
  }

  async write(session: StoredSession): Promise<void> {
    if (!isStoredSession(session)) throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Refusing invalid credentials');
    await writeSecureFile(this.path, JSON.stringify(session));
  }

  async delete(): Promise<boolean> {
    await rejectSymlink(this.path);
    try {
      await rm(this.path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

class KeyringCredentialStore implements CredentialStore {
  constructor(readonly profileId: string) {}

  private async entry() {
    try {
      // The native binding must remain an optional runtime dependency for every supported platform.
      const { AsyncEntry } = await import('@napi-rs/keyring') as KeyringModule;
      return new AsyncEntry('flashcard', this.profileId);
    } catch {
      throw new CredentialStoreError('CREDENTIAL_STORE_UNAVAILABLE', 'OS credential storage is unavailable; use auth login --credential-store file to opt in to file storage');
    }
  }

  async read(): Promise<StoredSession | null> {
    try {
      const password = await (await this.entry()).getPassword();
      if (!password) return null;
      const parsed: unknown = JSON.parse(password);
      if (!isStoredSession(parsed)) throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Stored credentials are invalid');
      return parsed;
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'OS credential storage could not be read');
    }
  }

  async write(session: StoredSession): Promise<void> {
    try { await (await this.entry()).setPassword(JSON.stringify(session)); }
    catch { throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'OS credential storage could not be written'); }
  }

  async delete(): Promise<boolean> {
    try { return await (await this.entry()).deletePassword(); }
    catch { throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'OS credential storage could not be cleared'); }
  }
}

interface Preference { version: 1; credentialStore: CredentialStoreKind; }

export class CredentialPreference {
  readonly path: string;
  constructor(readonly root: string) { this.path = join(root, 'config.json'); }

  async read(): Promise<CredentialStoreKind | null> {
    const raw = await readSecureFile(this.path);
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null && (value as Preference).version === 1 && ['keyring', 'file'].includes((value as Preference).credentialStore)) return (value as Preference).credentialStore;
    } catch { /* handled below */ }
    throw new CredentialStoreError('CREDENTIAL_STORE_ERROR', 'Credential configuration is invalid');
  }

  async write(kind: CredentialStoreKind): Promise<void> {
    await writeSecureFile(this.path, JSON.stringify({ version: 1, credentialStore: kind } satisfies Preference));
  }
}

export function createCredentialStore(kind: CredentialStoreKind, root: string, profileId: string): CredentialStore {
  return kind === 'file' ? new FileCredentialStore(root, profileId) : new KeyringCredentialStore(profileId);
}

  
