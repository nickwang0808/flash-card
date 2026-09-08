import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import { useAuth } from '@/auth/AuthProvider';

import { createApiClient, type ApiClient } from './client';
import { readFrontendEnvironment } from './environment';
import { supabase } from '@/auth/supabase';

const ApiContext = createContext<ApiClient | null>(null);

interface ApiProviderProps extends PropsWithChildren {
  client?: ApiClient;
}

export function ApiProvider({ children, client: injectedClient }: ApiProviderProps) {
  const { signOut } = useAuth();
  const client = useMemo(() => injectedClient ?? createApiClient({
    apiUrl: readFrontendEnvironment().apiUrl,
    getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    refreshSession: async () => Boolean((await supabase.auth.refreshSession()).data.session),
    clearSession: signOut,
  }), [injectedClient, signOut]);

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside ApiProvider');
  return client;
}
