export const queryKeys = {
  decks: ['decks'] as const,
  studyQueue: (deckId: string, limit: number) => ['study-queue', deckId, limit] as const,
};

export const STUDY_QUEUE_LIMIT = 50;
