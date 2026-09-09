import { describe, expect, it } from 'vitest';
import { readCliEnvironment, readFrontendEnvironment } from './environment.ts';

describe('client environment', () => {
  it('reads only explicit frontend public values', () => {
    expect(readFrontendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      EXPO_PUBLIC_API_URL: 'https://project.functions.supabase.co/api',
      EXPO_PUBLIC_AUTH_MODE: 'github',
      EXPO_PUBLIC_SITE_URL: 'https://example.com/flash-card/',
      DATABASE_URL: 'postgres://must-not-be-read',
    })).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-key',
      apiUrl: 'https://project.functions.supabase.co/api',
      authMode: 'github',
      siteUrl: 'https://example.com/flash-card/',
    });
  });


  it('uses the CLI names without Expo environment access', () => {
    expect(readCliEnvironment({
      FLASHCARD_SUPABASE_URL: 'https://project.supabase.co',
      FLASHCARD_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      FLASHCARD_API_URL: 'http://127.0.0.1:54321/functions/v1/api',
      FLASHCARD_OAUTH_CLIENT_ID: 'cli-client-id',
    })).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-key',
      apiUrl: 'http://127.0.0.1:54321/functions/v1/api',
      oauthClientId: 'cli-client-id',
    });
  });

  it('rejects missing values, invalid auth modes, and non-HTTP URLs', () => {
    expect(() => readFrontendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      EXPO_PUBLIC_API_URL: 'https://project.functions.supabase.co/api',
      EXPO_PUBLIC_AUTH_MODE: 'password',
      EXPO_PUBLIC_SITE_URL: 'https://example.com',
    })).toThrow('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');

    expect(() => readFrontendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      EXPO_PUBLIC_API_URL: 'https://project.functions.supabase.co/api',
      EXPO_PUBLIC_AUTH_MODE: 'email',
      EXPO_PUBLIC_SITE_URL: 'https://example.com',
    })).toThrow('EXPO_PUBLIC_AUTH_MODE must be password or github');

    expect(() => readCliEnvironment({
      FLASHCARD_SUPABASE_URL: 'ssh://project.supabase.co',
      FLASHCARD_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      FLASHCARD_API_URL: 'https://project.functions.supabase.co/api',
      FLASHCARD_OAUTH_CLIENT_ID: 'cli-client-id',
    })).toThrow('FLASHCARD_SUPABASE_URL must be an absolute HTTP(S) URL');
  });
});
