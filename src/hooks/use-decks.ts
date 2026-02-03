import { useQuery } from '@tanstack/react-query';
import { cardStore } from '../services/card-store';

export function useDecks() {
  return useQuery({
    queryKey: ['decks'],
    queryFn: async () => {
      await cardStore.loadAllDecks();
      const names = cardStore.getDeckNames();
      return names.map(name => ({
        name,
        dueCount: cardStore.getDueCount(name),
        newCount: cardStore.getNewCount(name),
      }));
    },
  });
}
