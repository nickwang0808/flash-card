import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useAuth } from '../hooks/useAuth';
import { GitHubStorageService, listUserRepos, parseRepoUrl } from '../services/github';

interface Props {
  onComplete: () => void;
}

export function AuthScreen({ onComplete }: Props) {
  const { settings, update } = useSettings();
  const { signInWithGitHub, hasGitHubToken, loading: authLoading } = useAuth();
  const [repoUrl, setRepoUrl] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [repos, setRepos] = useState<Array<{ full_name: string; html_url: string }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hasGitHubToken && settings.token) {
      listUserRepos(settings.token).then(setRepos).catch(() => {});
    }
  }, [hasGitHubToken, settings.token]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoUrl.toLowerCase()),
  );

  // Step 2: Repo URL form (shown after GitHub token is obtained)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const url = repoUrl.startsWith('http') ? repoUrl : `https://${repoUrl}`;

    try {
      setStatus('Validating credentials...');
      const { owner, repo } = parseRepoUrl(url);
      const service = new GitHubStorageService({ owner, repo, token: settings.token });

      const valid = await service.validateConnection();
      if (!valid) {
        setError('Cannot access repository. Check your URL and permissions.');
        setLoading(false);
        return;
      }

      setStatus('Checking deck structure...');
      const decks = await service.listDecks();

      if (decks.length === 0) {
        setError('No decks found. Repository should contain directories with cards.json files.');
        setLoading(false);
        return;
      }

      // Verify at least one dir has cards.json
      let foundDeck = false;
      try {
        const cards = await service.pullAllCards();
        foundDeck = cards.length > 0;
      } catch {
        // ignore
      }

      if (!foundDeck) {
        setError('No valid decks found. Each deck directory needs a cards.json file.');
        setLoading(false);
        return;
      }

      await update({ repoUrl: url });
      setStatus('Done!');
      onComplete();
    } catch (e: any) {
      setError(e.message || 'Connection failed. Check your URL.');
      setLoading(false);
    }
  }

  // Show loading while checking auth state
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
            Git-backed spaced repetition
          </p>
        </div>

        {!hasGitHubToken ? (
          /* Step 1: Sign in with GitHub */
          <div className="space-y-4">
            <button
              onClick={signInWithGitHub}
              className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              Sign in with GitHub
            </button>
          </div>
        ) : (
          /* Step 2: Repo URL input */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div ref={wrapperRef} className="relative">
              <label className="block text-sm font-medium mb-1">
                Repository URL
              </label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="https://github.com/user/flashcards"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
                disabled={loading}
              />
              {showDropdown && filteredRepos.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-md border border-input bg-background shadow-lg">
                  {filteredRepos.map((r) => (
                    <li
                      key={r.full_name}
                      onMouseDown={() => {
                        setRepoUrl(r.html_url);
                        setShowDropdown(false);
                      }}
                      className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
                    >
                      {r.full_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {loading && status && (
              <p className="text-sm text-muted-foreground">{status}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
