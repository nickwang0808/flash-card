import { useAuth } from '../hooks/useAuth';

interface Props {
  onComplete: () => void;
}

export function AuthScreen({ onComplete }: Props) {
  const { signInWithGitHub, devSignIn, isSignedIn, loading: authLoading } = useAuth();

  // Auto-navigate once signed in
  if (isSignedIn && !authLoading) {
    // Use setTimeout to avoid calling onComplete during render
    setTimeout(() => onComplete(), 0);
  }

  if (authLoading) {
    return (
      <div className="h-dvh flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Completing sign in...</p>
      </div>
    );
  }

  return (
    <div className="h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Flash Cards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Spaced repetition with cloud sync
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={signInWithGitHub}
            className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
          >
            Sign in with GitHub
          </button>
          {import.meta.env.DEV && (
            <button
              onClick={devSignIn}
              className="w-full rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Dev Login (local only)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
