import type { CliEnvironment } from '../api/environment.ts';
import { mkdir, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createApiClient, type ApiClient } from '../api/client.ts';
import { CredentialPreference, type CredentialStore, type CredentialStoreKind, createCredentialStore, configRoot, profileIdFor, type StoredSession } from './credentials.ts';
import { CliError } from './errors.ts';

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 60_000;

export class SessionManager {
  private current: StoredSession | null = null;
  readonly profileId: string;
  readonly root: string;
  readonly preference: CredentialPreference;
  private constructor(readonly environment: CliEnvironment, readonly kind: CredentialStoreKind, readonly store: CredentialStore) {
    this.profileId = profileIdFor(environment.supabaseUrl);
    this.root = configRoot();
    this.preference = new CredentialPreference(this.root);
  }

  static async create(environment: CliEnvironment, requestedKind?: CredentialStoreKind): Promise<SessionManager> {
    const root = configRoot();
    const profileId = profileIdFor(environment.supabaseUrl);
    const preference = new CredentialPreference(root);
    const remembered = await preference.read();
    const kind = requestedKind ?? remembered ?? 'keyring';
    if (requestedKind && remembered && requestedKind !== remembered) {
      const rememberedStore = createCredentialStore(remembered, root, profileId);
      let existing: StoredSession | null;
      try { existing = await rememberedStore.read(); }
      catch { throw new CliError('CREDENTIAL_STORE_ERROR', 'Existing credential store must be cleared before changing stores'); }
      if (existing) throw new CliError('CREDENTIAL_STORE_ERROR', 'Log out before changing credential stores');
    }
    return new SessionManager(environment, kind, createCredentialStore(kind, root, profileId));
  }

  api(): ApiClient {
    return createApiClient({
      apiUrl: this.environment.apiUrl,
      getAccessToken: () => this.getAccessToken(),
      refreshSession: () => this.refreshSession(),
      clearSession: () => this.clearSession(),
    });
  }

  async getAccessToken(): Promise<string | null> {
    this.current ??= await this.store.read();
    return this.current?.accessToken ?? null;
  }

  async requireSession(): Promise<StoredSession> {
    this.current ??= await this.store.read();
    if (!this.current) throw new CliError('UNAUTHENTICATED', 'No CLI session is stored; run auth login');
    return this.current;
  }

  async save(session: StoredSession, remember = false): Promise<void> {
    await this.withLock(async () => {
      await this.store.write(session);
      this.current = session;
      if (remember) await this.preference.write(this.kind);
    });
  }


  async refreshSession(): Promise<boolean> {
    return this.withLock(async () => {
      const stored = await this.store.read();
      if (!stored) { this.current = null; return false; }
      if (this.current && stored.accessToken !== this.current.accessToken) {
        this.current = stored;
        return true;
      }
      let response: Response;
      try {
        response = await fetch(new URL('/auth/v1/oauth/token', this.environment.supabaseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: stored.refreshToken,
            client_id: this.environment.oauthClientId,
          }),
        });
      } catch {
        throw new CliError('TRANSPORT_ERROR', 'Authentication service could not refresh the session');
      }
      if (response.status === 400 || response.status === 401) return false;
      if (!response.ok) throw new CliError('TRANSPORT_ERROR', 'Authentication service could not refresh the session');
      let data: unknown;
      try { data = await response.json(); } catch { throw new CliError('TRANSPORT_ERROR', 'Authentication service returned an invalid refresh response'); }
      if (typeof data !== 'object' || data === null) throw new CliError('TRANSPORT_ERROR', 'Authentication service returned an invalid refresh response');
      const tokens = data as Record<string, unknown>;
      if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || !tokens.access_token || !tokens.refresh_token) {
        throw new CliError('TRANSPORT_ERROR', 'Authentication service returned incomplete refresh credentials');
      }
      const refreshed: StoredSession = { version: 1, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
      await this.store.write(refreshed);
      this.current = refreshed;
      return true;
    });
  }

  async clearSession(): Promise<void> {
    await this.withLock(async () => {
      await this.store.delete();
      this.current = null;
    });
  }

  async logout(): Promise<{ hadSession: boolean }> {
    return this.withLock(async () => {
      const session = await this.store.read();
      await this.store.delete();
      this.current = null;
      return { hadSession: Boolean(session) };
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = join(this.root, 'locks', `${this.profileId}.lock`);
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        await mkdir(directory, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          if (Date.now() - (await stat(directory)).mtimeMs > LOCK_STALE_MS) await rmdir(directory);
        } catch (staleError) {
          if ((staleError as NodeJS.ErrnoException).code !== 'ENOENT') { /* another process may have won; retry */ }
        }
        if (Date.now() >= deadline) throw new CliError('CREDENTIAL_STORE_ERROR', 'Credential storage is busy');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try { return await operation(); } finally { await rmdir(directory).catch(() => undefined); }
  }
}

