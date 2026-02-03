import { useState, useEffect } from 'react';
import { getCommits, refreshData } from '../services/collections';

interface Props {
  onBack: () => void;
}

export function SyncScreen({ onBack }: Props) {
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<Array<{ message: string; sha: string; date: string }>>([]);

  useEffect(() => {
    loadInfo();
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function loadInfo() {
    try {
      const commits = await getCommits(10);
      setLog(commits);
    } catch {
      // offline or error
    }
  }

  async function handleRefresh() {
    setLoading(true);
    setStatus('Refreshing...');
    try {
      await refreshData();
      setStatus('Refreshed successfully');
      await loadInfo();
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen p-4 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          Back
        </button>
        <h1 className="text-xl font-bold">Sync</h1>
        <div className="w-10" />
      </div>

      {/* Status */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm">{online ? 'Online' : 'Offline'}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Reviews sync to GitHub automatically. Use Refresh to pull latest data from GitHub.
        </p>
        {status && (
          <p className="text-sm text-muted-foreground">{status}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-8">
        <button
          onClick={handleRefresh}
          disabled={loading || !online}
          className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Commit log */}
      <div>
        <h2 className="text-sm font-medium mb-2">Recent Commits</h2>
        <div className="space-y-2">
          {log.map((entry) => (
            <div key={entry.sha} className="text-xs border-l-2 border-border pl-3 py-1">
              <p className="font-mono text-muted-foreground">{entry.sha}</p>
              <p>{entry.message.split('\n')[0]}</p>
              <p className="text-muted-foreground">
                {new Date(entry.date).toLocaleString()}
              </p>
            </div>
          ))}
          {log.length === 0 && (
            <p className="text-xs text-muted-foreground">No commits yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
