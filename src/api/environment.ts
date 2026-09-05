export interface PublicClientEnvironment {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiUrl: string;
}

type EnvironmentValues = Record<string, string | undefined>;

export function readFrontendEnvironment(environment: EnvironmentValues = process.env): PublicClientEnvironment {
  return readEnvironment(environment, {
    supabaseUrl: 'EXPO_PUBLIC_SUPABASE_URL',
    supabasePublishableKey: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    apiUrl: 'EXPO_PUBLIC_API_URL',
  });
}

export function readCliEnvironment(environment: EnvironmentValues = process.env): PublicClientEnvironment {
  return readEnvironment(environment, {
    supabaseUrl: 'FLASHCARD_SUPABASE_URL',
    supabasePublishableKey: 'FLASHCARD_SUPABASE_PUBLISHABLE_KEY',
    apiUrl: 'FLASHCARD_API_URL',
  });
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
