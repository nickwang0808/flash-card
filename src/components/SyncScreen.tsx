import { useState, useEffect } from 'react';

interface Props {
  onBack: () => void;
}

export function SyncScreen({ onBack }: Props) {
  const [online, setOnline] = useState(navigator.onLine);

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
      </div>
    </div>
  );
}
