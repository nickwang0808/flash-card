import { useState } from 'react';
import { useDeck } from '../hooks/useDeck';
import { cardStatesCollection } from '../services/collections';
import { Rating, reviewCard as fsrsReview, createNewCardState, type Grade } from '../utils/fsrs';

interface Props {
  deck: string;
  onBack: () => void;
}

export function ReviewScreen({ deck, onBack }: Props) {
  const { currentCard, isLoading, deck: deckCards } = useDeck(deck);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

  // Filter out cards that were reviewed this session (in case optimistic update is slow)
  const actualCurrentCard = currentCard && !reviewedIds.has(currentCard.id) ? currentCard :
    deckCards.find(c => !reviewedIds.has(c.id) && (c.isNew || (c.due && c.due <= new Date()))) ?? null;

  function rate(rating: Grade) {
    if (!actualCurrentCard) return;

    // For new cards, create initial state first
    const currentState = actualCurrentCard.state ?? createNewCardState();
    const newState = fsrsReview(currentState, rating);

    // Override due for Again/Hard (in-session rescheduling)
    if (rating === Rating.Again) {
      newState.due = new Date(Date.now() + 60_000).toISOString();
    } else if (rating === Rating.Hard) {
      newState.due = new Date(Date.now() + 5 * 60_000).toISOString();
    }

    // Check if this card state exists in collection
    const existingState = cardStatesCollection.get(actualCurrentCard.id);

    if (existingState) {
      // Update existing state - use callback to modify draft
      cardStatesCollection.update(actualCurrentCard.id, (draft) => {
        draft.state = newState;
      });
    } else {
      // Insert new state for first-time reviewed cards
      cardStatesCollection.insert({
        id: actualCurrentCard.id,
        deckName: actualCurrentCard.deckName,
        cardId: actualCurrentCard.cardId,
        state: newState,
      });
    }

    // Track this card as reviewed (for immediate UI feedback)
    // For Again/Hard, don't add to reviewed set so it can reappear
    if (rating !== Rating.Again && rating !== Rating.Hard) {
      setReviewedIds(prev => new Set([...prev, actualCurrentCard.id]));
    }

    setAnswerRevealed(false);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading cards...</p>
      </div>
    );
  }

  const totalToday = deckCards.length;

  if (!actualCurrentCard) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <h2 className="text-xl font-bold">Session Complete</h2>
        <p className="text-muted-foreground">
          Reviewed {reviewedIds.size} card{reviewedIds.size !== 1 ? 's' : ''} this session
        </p>
        <p className="text-xs text-muted-foreground">
          {totalToday} cards scheduled for today
        </p>
        <button
          onClick={onBack}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          Done
        </button>
      </div>
    );
  }

  // Calculate progress
  const reviewed = reviewedIds.size;

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          End Session
        </button>
        <span className="text-sm text-muted-foreground">
          {reviewed + 1} / {totalToday}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-secondary rounded-full mb-8">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${(reviewed / totalToday) * 100}%` }}
        />
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {actualCurrentCard.isNew && (
          <span className="text-xs font-medium text-green-500 uppercase tracking-wider">
            New
          </span>
        )}

        <div className="text-center">
          <p className="text-3xl font-bold">{actualCurrentCard.source}</p>
          {actualCurrentCard.isReverse && (
            <p className="text-xs text-muted-foreground mt-1">reverse</p>
          )}
        </div>

        {answerRevealed ? (
          <div className="text-center space-y-3 animate-in fade-in">
            <p className="text-xl">{actualCurrentCard.translation}</p>
            {actualCurrentCard.example && (
              <p className="text-sm text-muted-foreground italic">
                {actualCurrentCard.example}
              </p>
            )}
            {actualCurrentCard.notes && (
              <p className="text-sm text-muted-foreground">{actualCurrentCard.notes}</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => setAnswerRevealed(true)}
            className="rounded-md border border-input px-6 py-3 text-sm font-medium hover:bg-accent"
          >
            Show Answer
          </button>
        )}
      </div>

      {/* Rating buttons */}
      {answerRevealed && (
        <div className="grid grid-cols-4 gap-2 mt-8 pb-4">
          <button
            onClick={() => rate(Rating.Again)}
            className="rounded-md bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-3 text-sm font-medium hover:bg-red-500/20"
          >
            Again
          </button>
          <button
            onClick={() => rate(Rating.Hard)}
            className="rounded-md bg-orange-500/10 text-orange-500 border border-orange-500/20 px-2 py-3 text-sm font-medium hover:bg-orange-500/20"
          >
            Hard
          </button>
          <button
            onClick={() => rate(Rating.Good)}
            className="rounded-md bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-3 text-sm font-medium hover:bg-green-500/20"
          >
            Good
          </button>
          <button
            onClick={() => rate(Rating.Easy)}
            className="rounded-md bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-3 text-sm font-medium hover:bg-blue-500/20"
          >
            Easy
          </button>
        </div>
      )}
    </div>
  );
}
