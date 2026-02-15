export interface CardData {
  deckName: string;
  term: string;              // raw key (TTS-readable, derived from JSON key)
  front?: string;            // markdown display for front (defaults to term)
  back: string;              // markdown display for back
  tags?: string[];
  created: string;
  reversible: boolean;
  state: Record<string, unknown> | null;
  reverseState: Record<string, unknown> | null;
  suspended?: boolean;
}

export interface GitStorageService {
  pullAllCards(): Promise<CardData[]>;
  pushCards(cards: CardData[]): Promise<void>;
  getCommits(limit?: number): Promise<Array<{ message: string; sha: string; date: string }>>;
  validateConnection(): Promise<boolean>;
  listDecks(): Promise<string[]>;
}
