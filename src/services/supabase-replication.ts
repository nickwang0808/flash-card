import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication';
import { Subject } from 'rxjs';
import type { RxCollection, RxReplicationWriteToMasterRow, WithDeleted, RxReplicationPullStreamItem } from 'rxdb/plugins/core';
import type { AppDatabase } from './rxdb';
import type { SupabaseClient } from '@supabase/supabase-js';

type Checkpoint = { id: string; modified: string };
export type ReplicationStates = RxReplicationState<any, Checkpoint>[];

// Map tables to their unique constraint columns for upsert conflict resolution.
// Default is 'id' (primary key). Tables with composite unique constraints need
// their natural key here so upserts resolve correctly even if the local RxDB
// generates a different UUID for the same logical row.
const UPSERT_CONFLICT_COLUMNS: Record<string, string> = {
  srs_state: '"cardId",direction',
};

function replicate<T>(
  collection: RxCollection<T>,
  client: SupabaseClient,
  tableName: string,
  userId: string,
): RxReplicationState<T, Checkpoint> {
  const primaryPath = collection.schema.primaryPath;
  const pullStream$ = new Subject<RxReplicationPullStreamItem<T, Checkpoint>>();

  const replicationState = replicateRxCollection<T, Checkpoint>({
    replicationIdentifier: `${tableName}-supabase`,
    collection,
    deletedField: '_deleted',
    pull: {
      async handler(lastCheckpoint: Checkpoint | undefined, batchSize: number) {
        let query = client.from(tableName).select('*').eq('userId', userId);

        if (lastCheckpoint) {
          // UUID primary keys — no special characters, .or() is safe
          query = query.or(
            `"_modified".gt.${lastCheckpoint.modified},and("_modified".eq.${lastCheckpoint.modified},"${primaryPath}".gt.${lastCheckpoint.id})`,
          );
        }

        query = query
          .order('_modified', { ascending: true })
          .order(primaryPath as string, { ascending: true })
          .limit(batchSize);

        const { data, error } = await query;
        if (error) throw error;

        const docs = (data ?? []).map((row: any) => {
          const doc = { ...row, _deleted: !!row._deleted };
          delete doc._modified;
          return doc as WithDeleted<T>;
        });

        const last = data?.[data.length - 1];
        return {
          documents: docs,
          checkpoint: last
            ? { id: last[primaryPath as string], modified: last._modified }
            : lastCheckpoint,
        };
      },
      stream$: pullStream$.asObservable(),
    },
    push: {
      async handler(rows: RxReplicationWriteToMasterRow<T>[]) {
        for (const row of rows) {
          const doc: any = { ...row.newDocumentState };
          if (doc._deleted) {
            doc._deleted = true;
          }
          delete doc._modified;

          const onConflict = UPSERT_CONFLICT_COLUMNS[tableName] ?? 'id';
          const { error } = await client.from(tableName).upsert(doc, { onConflict });
          if (error) {
            console.error(`[replication] push failed for ${tableName}:`, error.message, { id: doc.id });
            throw error;
          }
        }
        return [];
      },
    },
    live: true,
    autoStart: true,
  });

  // Subscribe to Realtime for live pull
  const startBefore = replicationState.start.bind(replicationState);
  const cancelBefore = replicationState.cancel.bind(replicationState);

  replicationState.start = () => {
    const channel = client
      .channel(`realtime:${tableName}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableName, filter: `userId=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          const row = payload.new as any;
          const doc = { ...row, _deleted: !!row._deleted };
          delete doc._modified;
          pullStream$.next({
            checkpoint: { id: doc[primaryPath as string], modified: row._modified },
            documents: [doc as WithDeleted<T>],
          });
        },
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          pullStream$.next('RESYNC');
        }
      });

    replicationState.cancel = () => {
      channel.unsubscribe();
      return cancelBefore();
    };

    return startBefore();
  };

  return replicationState;
}

export function startReplication(
  db: AppDatabase,
  client: SupabaseClient,
  userId: string,
): { states: ReplicationStates; initialSyncDone: Promise<void> } {
  const states = [
    replicate(db.cards, client, 'cards', userId),
    replicate(db.srsState, client, 'srs_state', userId),
    replicate(db.reviewLogs, client, 'review_logs', userId),
    replicate(db.settings, client, 'settings', userId),
  ];

  const initialSyncDone = Promise.all(
    states.map((s) => s.awaitInitialReplication()),
  ).then(() => {});

  return { states, initialSyncDone };
}

export async function cancelReplication(states: ReplicationStates): Promise<void> {
  await Promise.all(states.map((s) => s.cancel()));
}
