import { replicateSupabase, type RxSupabaseReplicationState } from 'rxdb/plugins/replication-supabase';
import type { AppDatabase } from './rxdb';
import type { SupabaseClient } from '@supabase/supabase-js';

type ReplicationStates = RxSupabaseReplicationState<any>[];

export function startReplication(
  db: AppDatabase,
  client: SupabaseClient,
  userId: string,
): ReplicationStates {
  const opts = (tableName: string, collection: any) =>
    replicateSupabase({
      replicationIdentifier: `${tableName}-supabase`,
      collection,
      client,
      tableName,
      pull: {
        queryBuilder: ({ query }) => query.eq('user_id', userId),
      },
      push: {},
      live: true,
      autoStart: true,
    });

  return [
    opts('cards', db.cards),
    opts('srs_state', db.srs_state),
    opts('review_logs', db.review_logs),
    opts('settings', db.settings),
  ];
}

export async function cancelReplication(states: ReplicationStates): Promise<void> {
  await Promise.all(states.map((s) => s.cancel()));
}

export async function resyncAll(states: ReplicationStates): Promise<void> {
  await Promise.all(states.map((s) => s.reSync()));
}
