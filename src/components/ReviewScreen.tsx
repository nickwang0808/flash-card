import { useState } from 'react';
import { Rating, type Grade } from 'ts-fsrs';
import { useDeck } from '../hooks/useDeck';

interface Props {
  deck: string;
  onBack: () => void;
}

export function ReviewScreen({ deck, onBack }: Props) {
  const { currentCard, remaining, rate, suspend, isLoading } = useDeck(deck);
  const [answerRevealed, setAnswerRevealed] = useState(false);

  function handleRate(rating: Grade) {
    rate(rating);
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
        <div className="flex items-center gap-3">
          <button
            onClick={suspend}
            className="text-sm text-muted-foreground hover:text-foreground"
            title="Suspend this card permanently"
          >
            Suspend
          </button>
          <span className="text-sm text-muted-foreground">
            {remaining} remaining
          </span>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {currentCard.isNew && (
          <span className="text-xs font-medium text-green-500 uppercase tracking-wider">
            New
          </span>
        )}

        <div className="text-center">
          <p className="text-3xl font-bold">{currentCard.front}</p>
          {currentCard.isReverse && (
            <p className="text-xs text-muted-foreground mt-1">reverse</p>
          )}
        </div>

        {answerRevealed ? (
          <div className="text-center space-y-3 animate-in fade-in">
            <p className="text-xl">{currentCard.back}</p>
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
            onClick={() => handleRate(Rating.Again)}
            className="rounded-md bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-3 text-sm font-medium hover:bg-red-500/20"
          >
            Again
          </button>
          <button
            onClick={() => handleRate(Rating.Hard)}
            className="rounded-md bg-orange-500/10 text-orange-500 border border-orange-500/20 px-2 py-3 text-sm font-medium hover:bg-orange-500/20"
          >
            Hard
          </button>
          <button
            onClick={() => handleRate(Rating.Good)}
            className="rounded-md bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-3 text-sm font-medium hover:bg-green-500/20"
          >
            Good
          </button>
          <button
            onClick={() => handleRate(Rating.Easy)}
            className="rounded-md bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-3 text-sm font-medium hover:bg-blue-500/20"
          >
            Easy
          </button>
        </div>
      )}
    </div>
  );
}
