import React from 'react';
import ReactDOM from 'react-dom/client';
import { getDatabase, type AppDatabase } from './services/rxdb';
import { RxDbCardRepository, setCardRepository } from './services/card-repository';
import { RxDbReviewLogRepository, setReviewLogRepository } from './services/review-log-repository';
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

// Initialize RxDB, then render app
async function bootstrap() {
  const db = await getDatabase();

  // Initialize repositories
  setCardRepository(new RxDbCardRepository(db));
  setReviewLogRepository(new RxDbReviewLogRepository(db));

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
