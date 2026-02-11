import { useState, useEffect } from 'react';
import type { RxCollection, MangoQuery } from 'rxdb/plugins/core';

/**
 * React hook that subscribes to an RxDB collection query.
 * Bypasses the TanStack DB bridge (which has issues with bulk inserts)
 * and provides direct reactive access to RxDB data.
 */
export function useRxQuery<T>(
  collection: RxCollection<T>,
  query?: MangoQuery<T>,
): { data: T[]; isLoading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Stable stringified query for deps
  const queryKey = query ? JSON.stringify(query) : '';

  useEffect(() => {
    const sub = collection.find(query).$.subscribe((docs) => {
      setData(docs.map((d) => d.toJSON() as T));
      setIsLoading(false);
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, queryKey]);

  return { data, isLoading };
}
