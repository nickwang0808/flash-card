import React from 'react';
import ReactDOM from 'react-dom/client';
import { initCollections } from './services/collections';
import { getDatabase } from './services/rxdb';
import { setupReplication } from './services/replication';
import { App } from './components/App';
import './styles/main.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Show loading while RxDB initializes
root.render(
  <React.StrictMode>
    <div className="h-dvh flex items-center justify-center">Loading...</div>
  </React.StrictMode>,
);

// Initialize RxDB + collections, then render app
async function bootstrap() {
  await initCollections();
  const db = await getDatabase();
  await setupReplication(db);
}

bootstrap().then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
