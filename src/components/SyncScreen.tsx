import { useState, useEffect } from 'react';
import { syncManager, type SyncResult } from '../services/sync-manager';
import { gitService } from '../services/git-service';
import { settingsStore } from '../services/settings-store';

interface Props {
  onBack: () => void;
}

export function SyncScreen({ onBack }: Props) {
  const [online, setOnline] = useState(navigator.onLine);
  const [lastSync, setLastSync] = useState(syncManager.getLastSyncTime());
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<Array<{ message: string; oid: string; timestamp: number }>>([]);
  const [pendingCommits, setPendingCommits] = useState(false);

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
    const commits = await gitService.getLog(10);
    setLog(commits);
    const config = settingsStore.get();
    const hasPending = await gitService.hasUnpushedCommits({ repoUrl: config.repoUrl, token: config.token });
    setPendingCommits(hasPending);
  }

  function showResult(result: SyncResult) {
    if (result.status === 'ok') {
      setStatus('Synced successfully');
    } else if (result.status === 'conflict') {
      setStatus(`Conflict — pushed to branch: ${result.branch}`);
    } else {
      setStatus(`Error: ${result.message}`);
    }
    setLastSync(syncManager.getLastSyncTime());
    loadInfo();
  }

  async function handlePull() {
    setLoading(true);
    setStatus('Pulling...');
    showResult(await syncManager.pull());
    setLoading(false);
  }

  async function handlePush() {
    setLoading(true);
    setStatus('Pushing...');
    showResult(await syncManager.push());
    setLoading(false);
  }

  async function handlePushAsBranch() {
    setLoading(true);
    setStatus('Pushing as branch...');
    showResult(await syncManager.pushAsBranch());
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
        {lastSync && (
          <p className="text-xs text-muted-foreground">
            Last sync: {new Date(lastSync).toLocaleString()}
          </p>
        )}
        {pendingCommits && (
          <p className="text-xs text-orange-500">Unpushed commits</p>
        )}
        {status && (
          <p className="text-sm text-muted-foreground">{status}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-8">
        <button
          onClick={handlePull}
          disabled={loading || !online}
          className="flex-1 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          Pull
        </button>
        <button
          onClick={handlePush}
          disabled={loading || !online}
          className="flex-1 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          Push
        </button>
        <button
          onClick={handlePushAsBranch}
          disabled={loading || !online}
          className="flex-1 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50 text-xs"
        >
          Push as Branch
        </button>
      </div>

      {/* Git log */}
      <div>
        <h2 className="text-sm font-medium mb-2">Recent Commits</h2>
        <div className="space-y-2">
          {log.map((entry) => (
            <div key={entry.oid} className="text-xs border-l-2 border-border pl-3 py-1">
              <p className="font-mono text-muted-foreground">{entry.oid}</p>
              <p>{entry.message.split('\n')[0]}</p>
              <p className="text-muted-foreground">
                {new Date(entry.timestamp).toLocaleString()}
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
