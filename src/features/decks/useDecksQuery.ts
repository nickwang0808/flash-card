import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiProvider';
import { queryKeys } from '@/query/keys';

export function useDecksQuery() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.decks,
    queryFn: () => api.deck.list.query({}),
  });
}
