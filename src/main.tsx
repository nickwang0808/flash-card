import React from 'react';
import ReactDOM from 'react-dom/client';
import { getDatabase, type AppDatabase } from './services/rxdb';
import { setupReplication } from './services/replication';
import { App } from './components/App';
import './styles/main.css';

declare global {
  interface Window {
    __RXDB__?: AppDatabase;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Show loading while RxDB initializes
root.render(
  <React.StrictMode>
    <div className="h-dvh flex items-center justify-center">Loading...</div>
  </React.StrictMode>,
);

// One-time migration: move settings from localStorage (TanStack DB format) to RxDB
async function migrateSettings(db: AppDatabase): Promise<void> {
  const raw = localStorage.getItem('flash-card-settings');
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    const data = parsed['s:settings']?.data;
    if (data && data.repoUrl) {
      await db.settings.upsert({
        id: data.id ?? 'settings',
        repoUrl: data.repoUrl ?? '',
        token: data.token ?? '',
        newCardsPerDay: data.newCardsPerDay ?? 10,
        reviewOrder: data.reviewOrder ?? 'random',
        theme: data.theme ?? 'system',
        ...(data.branch ? { branch: data.branch } : {}),
      });
    }
  } catch {
    // Corrupt data — ignore
  }

  localStorage.removeItem('flash-card-settings');
}

// Initialize RxDB, then render app
async function bootstrap() {
  const db = await getDatabase();
  await migrateSettings(db);
  setupReplication(db);

  // Expose for E2E tests
  if (import.meta.env.DEV) {
    window.__RXDB__ = db;
  }
}

bootstrap().then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
