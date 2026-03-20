import React from 'react';
import ReactDOM from 'react-dom/client';
import { getDatabase, type AppDatabase } from './services/rxdb';
import { supabase } from './services/supabase';
import { App } from './components/App';
import './styles/main.css';

import type { SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __RXDB__?: AppDatabase;
    __SUPABASE__?: SupabaseClient;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <div className="h-dvh flex items-center justify-center">Loading...</div>
  </React.StrictMode>,
);

async function bootstrap() {
  const db = await getDatabase();

  if (import.meta.env.DEV) {
    window.__RXDB__ = db;
    window.__SUPABASE__ = supabase;
  }
}

bootstrap().then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
