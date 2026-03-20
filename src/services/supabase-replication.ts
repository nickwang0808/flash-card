import { replicateSupabase, type RxSupabaseReplicationState } from 'rxdb/plugins/replication-supabase';
import type { AppDatabase } from './rxdb';
import type { SupabaseClient } from '@supabase/supabase-js';

type ReplicationStates = RxSupabaseReplicationState<any>[];

export function startReplication(
  db: AppDatabase,
  client: SupabaseClient,
  userId: string,
): ReplicationStates {
  const replicate = (tableName: string, collection: any) =>
    replicateSupabase({
      replicationIdentifier: `${tableName}-supabase`,
      collection,
      client,
      tableName,
      pull: {
        queryBuilder: ({ query }) => query.eq('userId', userId),
      },
      push: {},
      live: true,
      autoStart: true,
    });

  return [
    replicate('cards', db.cards),
    replicate('srs_state', db.srsState),
    replicate('review_logs', db.reviewLogs),
    replicate('settings', db.settings),
  ];
}

export async function cancelReplication(states: ReplicationStates): Promise<void> {
  await Promise.all(states.map((s) => s.cancel()));
}
