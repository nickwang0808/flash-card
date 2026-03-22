import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../services/supabase';

export function useAuth() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsSignedIn(!!session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          setIsSignedIn(true);

          // Clean up OAuth URL params after redirect (web only)
          if (Platform.OS === 'web' && (window.location.hash || window.location.search)) {
            window.history.replaceState({}, '', window.location.pathname);
          }
        } else if (event === 'SIGNED_OUT') {
          setIsSignedIn(false);
        }

        setLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGitHub = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: Platform.OS === 'web'
          ? window.location.origin + window.location.pathname
          : undefined,
      },
    });
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setIsSignedIn(false);
  }, []);

  const devSignIn = useCallback(async () => {
    const email = 'dev@localhost';
    const password = 'devdevdev';

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
    }
  }, []);

  return { signInWithGitHub, devSignIn, signOut, isSignedIn, loading };
}
