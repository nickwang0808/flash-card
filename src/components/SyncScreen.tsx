import { useState, useEffect } from 'react';
import { runSync } from '../services/replication';

interface Props {
  onBack: () => void;
}

export function SyncScreen({ onBack }: Props) {
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function handleSync() {
    setLoading(true);
    setStatus('Syncing...');
    try {
      await runSync();
      setStatus('Synced successfully');
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  return (
    <div className="h-dvh overflow-y-auto p-4 max-w-md mx-auto">
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
          Reviews are saved locally. Use Sync to push changes to Supabase and pull the latest data.
        </p>
        {status && (
          <p className="text-sm text-muted-foreground">{status}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-8">
        <button
          onClick={handleSync}
          disabled={loading || !online}
          className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          Sync
        </button>
      </div>
    </div>
  );
}
