export type FrontendAuthMode = 'password' | 'github';

export interface PublicClientEnvironment {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiUrl: string;
}

export interface FrontendEnvironment extends PublicClientEnvironment {
  authMode: FrontendAuthMode;
  siteUrl: string;
}

export interface CliEnvironment extends PublicClientEnvironment {
  oauthClientId: string;
}

type EnvironmentValues = Record<string, string | undefined>;

export function readFrontendEnvironment(environment: EnvironmentValues = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_AUTH_MODE: process.env.EXPO_PUBLIC_AUTH_MODE,
  EXPO_PUBLIC_SITE_URL: process.env.EXPO_PUBLIC_SITE_URL,
}): FrontendEnvironment {
  const client = readEnvironment(environment, {
    supabaseUrl: 'EXPO_PUBLIC_SUPABASE_URL',
    supabasePublishableKey: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    apiUrl: 'EXPO_PUBLIC_API_URL',
  });
  const authMode = requiredValue(environment, 'EXPO_PUBLIC_AUTH_MODE');
  if (authMode !== 'password' && authMode !== 'github') throw new Error('EXPO_PUBLIC_AUTH_MODE must be password or github');
  return { ...client, authMode, siteUrl: requiredHttpUrl(environment, 'EXPO_PUBLIC_SITE_URL') };
}

export function readCliEnvironment(environment: EnvironmentValues = process.env): CliEnvironment {
  return {
    ...readEnvironment(environment, {
      supabaseUrl: 'FLASHCARD_SUPABASE_URL',
      supabasePublishableKey: 'FLASHCARD_SUPABASE_PUBLISHABLE_KEY',
      apiUrl: 'FLASHCARD_API_URL',
    }),
    oauthClientId: requiredValue(environment, 'FLASHCARD_OAUTH_CLIENT_ID'),
  };
}

function readEnvironment(
  environment: EnvironmentValues,
  names: Record<keyof PublicClientEnvironment, string>,
): PublicClientEnvironment {
  const supabaseUrl = requiredHttpUrl(environment, names.supabaseUrl);
  const apiUrl = requiredHttpUrl(environment, names.apiUrl);
  const supabasePublishableKey = requiredValue(environment, names.supabasePublishableKey);
  return { supabaseUrl, supabasePublishableKey, apiUrl };
}

function requiredHttpUrl(environment: EnvironmentValues, name: string): string {
  const value = requiredValue(environment, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  return value;
}

function requiredValue(environment: EnvironmentValues, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
