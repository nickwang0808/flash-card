import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createApiClient, type ApiClient } from '../api/client.ts';
import type { PublicClientEnvironment } from '../api/environment.ts';
import { CredentialPreference, type CredentialStore, type CredentialStoreKind, createCredentialStore, configRoot, profileIdFor, type StoredSession } from './credentials.ts';
import { CliError } from './errors.ts';

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 60_000;

export class SessionManager {
  private current: StoredSession | null = null;
  readonly profileId: string;
  readonly root: string;
  readonly preference: CredentialPreference;
  readonly auth: SupabaseClient;

  private constructor(readonly environment: PublicClientEnvironment, readonly kind: CredentialStoreKind, readonly store: CredentialStore) {
    this.profileId = profileIdFor(environment.supabaseUrl);
    this.root = configRoot();
    this.preference = new CredentialPreference(this.root);
    this.auth = createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  static async create(environment: PublicClientEnvironment, requestedKind?: CredentialStoreKind): Promise<SessionManager> {
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
      const { data, error } = await this.auth.auth.refreshSession({ refresh_token: stored.refreshToken });
      if (error || !data.session) {
        if (error && /invalid|expired|refresh token|unauthorized/i.test(error.message)) return false;
        throw new CliError('TRANSPORT_ERROR', 'Authentication service could not refresh the session');
      }
      const refreshed: StoredSession = { version: 1, accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
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
      this.current = session;
      let remoteError = false;
      try {
        if (session) {
          const { error: setError } = await this.auth.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
          if (setError) remoteError = true;
          else {
            const { error } = await this.auth.auth.signOut({ scope: 'local' });
            remoteError = Boolean(error);
          }
        }
      } finally {
        await this.store.delete();
        this.current = null;
      }
      if (remoteError) throw new CliError('TRANSPORT_ERROR', 'Remote logout failed', { localCredentialsRemoved: true });
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

