import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { HTTPBatchLinkOptions, TRPCClient } from '@trpc/client';
import type { AppRouter } from '../../supabase/functions/api/router.ts';

export type AccessTokenProvider = () => Promise<string | null>;
export type SessionRefresher = () => Promise<boolean>;
export type SessionClearer = () => Promise<void> | void;

type ClientFetch = NonNullable<HTTPBatchLinkOptions<AppRouter['_def']['_config']['$types']>['fetch']>;

export interface ApiClientOptions {
  apiUrl: string | URL;
  getAccessToken: AccessTokenProvider;
  refreshSession?: SessionRefresher;
  clearSession: SessionClearer;
  fetch?: ClientFetch;
}

export type ApiClient = TRPCClient<AppRouter>;

/**
 * Creates the sole application API transport. Credential persistence belongs to
 * each caller; this transport reads the current token for every HTTP request.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let inFlightRefresh: Promise<boolean> | null = null;

  const refreshSession = async (): Promise<boolean> => {
    if (!options.refreshSession) return false;
    inFlightRefresh ??= Promise.resolve(options.refreshSession()).finally(() => {
      inFlightRefresh = null;
    });
    return inFlightRefresh;
  };

  const send = async (...[input, init]: Parameters<ClientFetch>): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const accessToken = (await options.getAccessToken())?.trim();
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    } else {
      headers.delete('Authorization');
    }

    return fetchImpl(input, { ...init, headers }) as Promise<Response>;
  };

  const authenticatedFetch: ClientFetch = async (...args) => {
    let response = await send(...args);
    if (response.status !== 401) return response;

    if (!(await refreshSession())) {
      await options.clearSession();
      return response;
    }

    response = await send(...args);
    if (response.status === 401) await options.clearSession();
    return response;
  };

  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: options.apiUrl, fetch: authenticatedFetch })],
  });
}
