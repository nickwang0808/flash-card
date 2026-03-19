import { useState, useEffect } from 'react';

interface Props {
  onBack: () => void;
}

export function SyncScreen({ onBack }: Props) {
  const [online, setOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<string>('');

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

  function handleSync() {
    setStatus('Sync is automatic — data syncs in real-time when online.');
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

      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm">{online ? 'Online' : 'Offline'}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes sync automatically when online. Reviews are always saved locally first.
        </p>
        {status && (
          <p className="text-sm text-muted-foreground">{status}</p>
        )}
      </div>

      <div className="flex gap-2 mb-8">
        <button
          onClick={handleSync}
          disabled={!online}
          className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          Check Status
        </button>
      </div>
    </div>
  );
}
