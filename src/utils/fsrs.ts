import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';

const params = generatorParameters();
const scheduler = fsrs(params);

export { Rating, type Card, type Grade };

export interface CardState {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number; // State enum value
  last_review?: string;
  suspended: boolean;
}

export function createNewCardState(): CardState {
  const card = createEmptyCard();
  return cardToState(card);
}

export function cardToState(card: Card): CardState {
  return {
    due: card.due.toISOString ? card.due.toISOString() : new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review
      ? (card.last_review.toISOString ? card.last_review.toISOString() : new Date(card.last_review).toISOString())
      : undefined,
    suspended: false,
  };
}

export function stateToCard(state: CardState): Card {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.last_review ? new Date(state.last_review) : undefined,
  } as Card;
}

export function reviewCard(state: CardState, rating: Grade, now?: Date): CardState {
  const card = stateToCard(state);
  const result = scheduler.repeat(card, now ?? new Date());
  const updated = result[rating].card;
  return {
    ...cardToState(updated),
    suspended: state.suspended,
  };
}

export function isDue(state: CardState, now?: Date): boolean {
  return new Date(state.due) <= (now ?? new Date());
}

export function isNew(state: CardState): boolean {
  return state.reps === 0;
}

export function ratingName(rating: Grade): string {
  switch (rating) {
    case Rating.Again: return 'Again';
    case Rating.Hard: return 'Hard';
    case Rating.Good: return 'Good';
    case Rating.Easy: return 'Easy';
    default: return String(rating);
  }
}
