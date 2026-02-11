import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useSettings } from './useSettings';

export function useAuth() {
  const { settings, update } = useSettings();
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const hasGitHubToken = settings.token.length > 0;

  useEffect(() => {
    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsSignedIn(!!session);

      // If Supabase session exists but we lost the token from localStorage, force sign-out
      if (session && !settings.token) {
        supabase.auth.signOut();
        setIsSignedIn(false);
      }

      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session?.provider_token) {
          // Capture the GitHub access token — this is the only chance to grab it
          update({ token: session.provider_token });
          setIsSignedIn(true);

          // Clean up OAuth URL params after redirect
          if (window.location.hash || window.location.search) {
            window.history.replaceState({}, '', window.location.pathname);
          }
        } else if (event === 'SIGNED_OUT') {
          setIsSignedIn(false);
        }

        setLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signInWithGitHub = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { scopes: 'repo' },
    });
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setIsSignedIn(false);
  }, []);

  return { signInWithGitHub, signOut, isSignedIn, hasGitHubToken, loading };
}
