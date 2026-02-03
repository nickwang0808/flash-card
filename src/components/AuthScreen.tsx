import { useState } from 'react';
import { settingsStore } from '../services/settings-store';
import { github, parseRepoUrl } from '../services/github';

interface Props {
  onComplete: () => void;
}

export function AuthScreen({ onComplete }: Props) {
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const url = repoUrl.startsWith('http') ? repoUrl : `https://${repoUrl}`;

    try {
      setStatus('Validating credentials...');
      const { owner, repo } = parseRepoUrl(url);
      const config = { owner, repo, token };

      const valid = await github.validateRepo(config);
      if (!valid) {
        setError('Cannot access repository. Check your URL and token.');
        setLoading(false);
        return;
      }

      setStatus('Checking deck structure...');
      const entries = await github.listDirectory(config, '');
      const dirs = entries.filter(e => e.type === 'dir' && !e.name.startsWith('.'));

      if (dirs.length === 0) {
        setError('No decks found. Repository should contain directories with cards.json files.');
        setLoading(false);
        return;
      }

      // Verify at least one dir has cards.json
      let foundDeck = false;
      for (const dir of dirs) {
        try {
          await github.readFile(config, `${dir.name}/cards.json`);
          foundDeck = true;
          break;
        } catch {
          continue;
        }
      }

      if (!foundDeck) {
        setError('No valid decks found. Each deck directory needs a cards.json file.');
        setLoading(false);
        return;
      }

      settingsStore.set({ repoUrl: url, token });
      setStatus('Done!');
      onComplete();
    } catch (e: any) {
      setError(e.message || 'Connection failed. Check your URL and token.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Flash Cards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Git-backed spaced repetition
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Repository URL
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/user/flashcards"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Personal Access Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Fine-grained PAT with contents: read/write
            </p>
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
      </div>
    </div>
  );
}
