import { useState, useEffect } from 'react';
import type { AppDatabase } from './rxdb';

// Stored version of ReviewLog with serialized dates
export interface StoredReviewLog {
  id: string;                  // cardSource:direction:timestamp
  cardSource: string;
  isReverse: boolean;
  rating: number;              // Rating enum value
  state: number;               // State enum value
  due: string;                 // ISO date
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: string;              // ISO date
}

export interface ReviewLogRepository {
  insert(log: StoredReviewLog): Promise<void>;
  remove(id: string): Promise<void>;
  subscribe(cb: (logs: StoredReviewLog[]) => void): () => void;
}

// --- RxDB implementation ---

export class RxDbReviewLogRepository implements ReviewLogRepository {
  constructor(private db: AppDatabase) {}

  async insert(log: StoredReviewLog): Promise<void> {
    await this.db.reviewlogs.insert(log);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.db.reviewlogs.findOne(id).exec();
    if (doc) await doc.remove();
  }

  subscribe(cb: (logs: StoredReviewLog[]) => void): () => void {
    const sub = this.db.reviewlogs.find().$.subscribe((docs) => {
      cb(docs.map((d) => d.toJSON() as unknown as StoredReviewLog));
    });
    return () => sub.unsubscribe();
  }
}

// --- DI ---

let instance: ReviewLogRepository | null = null;

export function getReviewLogRepository(): ReviewLogRepository {
  if (!instance) throw new Error('ReviewLogRepository not initialized. Call setReviewLogRepository() first.');
  return instance;
}

export function setReviewLogRepository(repo: ReviewLogRepository | null): void {
  instance = repo;
}

// --- React hook ---

export function useReviewLogs(): { data: StoredReviewLog[]; isLoading: boolean } {
  const [data, setData] = useState<StoredReviewLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const repo = getReviewLogRepository();
    const unsub = repo.subscribe((logs) => {
      setData(logs);
      setIsLoading(false);
    });
    return unsub;
  }, []);

  return { data, isLoading };
}
