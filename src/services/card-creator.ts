import type { CardsDoc } from './rxdb-schemas.generated';

export function buildCard(params: {
  userId: string;
  deckName: string;
  term: string;
  translation: string;
  reversible?: boolean;
}): CardsDoc {
  return {
    id: crypto.randomUUID(),
    userId: params.userId,
    deckName: params.deckName,
    term: params.term,
    front: params.term,
    back: params.translation,
    tags: '[]',
    created: new Date().toISOString(),
    reversible: params.reversible ?? true,
    order: 0,
    suspended: false,
    approved: false,
  };
}
