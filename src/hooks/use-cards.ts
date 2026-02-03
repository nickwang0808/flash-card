import { useQuery } from '@tanstack/react-query';
import { cardStore } from '../services/card-store';

export function useCards(deck: string) {
  return useQuery({
    queryKey: ['cards', deck],
    queryFn: () => cardStore.getReviewableCards(deck),
    enabled: !!deck,
  });
}
