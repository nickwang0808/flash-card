import { useState } from 'react';
import { fsrs, createEmptyCard, Rating, type Grade } from 'ts-fsrs';
import { useDeck } from '../hooks/useDeck';

interface Props {
  deck: string;
  onBack: () => void;
}

export function ReviewScreen({ deck, onBack }: Props) {
  const { newItems, dueItems, isLoading, collection } = useDeck(deck);
  const [answerRevealed, setAnswerRevealed] = useState(false);

  // New cards first, then due cards
  const allItems = [...newItems, ...dueItems];
  const currentCard = allItems[0] ?? null;

  function rate(rating: Grade) {
    if (!currentCard) return;

    const isReverse = currentCard.isReverse;
    const existingState = isReverse ? currentCard.reverseState : currentCard.state;
    const currentState = existingState ? existingState : createEmptyCard();
    const newState = fsrs().repeat(currentState, new Date())[rating].card;

    // Update card - FSRS handles scheduling, reactive system handles the list
    collection.update(currentCard.source, (draft) => {
      if (isReverse) {
        draft.reverseState = newState;
      } else {
        draft.state = newState;
      }
    });

    setAnswerRevealed(false);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading cards...</p>
      </div>
    );
  }

  if (!currentCard) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <h2 className="text-xl font-bold">Session Complete</h2>
        <p className="text-muted-foreground">No more cards to review today.</p>
        <button
          onClick={onBack}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          Done
        </button>
      </div>
    );
  }

  // Determine front/back based on direction
  const front = currentCard.isReverse ? currentCard.translation : currentCard.source;
  const back = currentCard.isReverse ? currentCard.source : currentCard.translation;
  const isNew = currentCard.isReverse ? !currentCard.reverseState : !currentCard.state;

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
          {allItems.length} remaining
        </span>
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {isNew && (
          <span className="text-xs font-medium text-green-500 uppercase tracking-wider">
            New
          </span>
        )}

        <div className="text-center">
          <p className="text-3xl font-bold">{front}</p>
          {currentCard.isReverse && (
            <p className="text-xs text-muted-foreground mt-1">reverse</p>
          )}
        </div>

        {answerRevealed ? (
          <div className="text-center space-y-3 animate-in fade-in">
            <p className="text-xl">{back}</p>
            {currentCard.example && (
              <p className="text-sm text-muted-foreground italic">
                {currentCard.example}
              </p>
            )}
            {currentCard.notes && (
              <p className="text-sm text-muted-foreground">{currentCard.notes}</p>
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
