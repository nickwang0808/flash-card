import { describe, expect, it } from 'vitest';
import { readCliEnvironment, readFrontendEnvironment } from './environment.ts';

describe('client environment', () => {
  it('reads only the explicit frontend public values', () => {
    expect(readFrontendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      EXPO_PUBLIC_API_URL: 'https://project.functions.supabase.co/api',
      DATABASE_URL: 'postgres://must-not-be-read',
    })).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-key',
      apiUrl: 'https://project.functions.supabase.co/api',
    });
  });

  it('uses the CLI names without Expo environment access', () => {
    expect(readCliEnvironment({
      FLASHCARD_SUPABASE_URL: 'https://project.supabase.co',
      FLASHCARD_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      FLASHCARD_API_URL: 'http://127.0.0.1:54321/functions/v1/api',
    })).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-key',
      apiUrl: 'http://127.0.0.1:54321/functions/v1/api',
    });
  });

  it('rejects missing values and non-HTTP URLs', () => {
    expect(() => readFrontendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      EXPO_PUBLIC_API_URL: 'https://project.functions.supabase.co/api',
    })).toThrow('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');

    expect(() => readCliEnvironment({
      FLASHCARD_SUPABASE_URL: 'ssh://project.supabase.co',
      FLASHCARD_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      FLASHCARD_API_URL: 'https://project.functions.supabase.co/api',
    })).toThrow('FLASHCARD_SUPABASE_URL must be an absolute HTTP(S) URL');
  });
});
