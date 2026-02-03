import { useState, useEffect } from 'react';
import { reviewSession } from '../services/review-session';
import { cardStore } from '../services/card-store';
import { Rating } from '../utils/fsrs';
import { gitService } from '../services/git-service';
import { settingsStore } from '../services/settings-store';

interface Props {
  deck: string;
  onBack: () => void;
}

export function ReviewScreen({ deck, onBack }: Props) {
  const [, forceUpdate] = useState(0);
  const [rating, setRating] = useState(false);

  useEffect(() => {
    const unsub = reviewSession.subscribe(() => forceUpdate((n) => n + 1));
    reviewSession.start(deck);
    return unsub;
  }, [deck]);

  const state = reviewSession.getState();
  const card = reviewSession.getCurrentCard();

  async function handleRate(r: typeof Rating.Again | typeof Rating.Hard | typeof Rating.Good | typeof Rating.Easy) {
    setRating(true);
    await reviewSession.rate(r);
    setRating(false);
  }

  async function handleEnd() {
    try {
      const config = settingsStore.get();
      await gitService.push({ repoUrl: config.repoUrl, token: config.token });
    } catch {
      // Push failed, that's ok — will sync later
    }
    reviewSession.end();
    onBack();
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (reviewSession.isComplete()) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <h2 className="text-xl font-bold">Session Complete</h2>
        <p className="text-muted-foreground">
          Reviewed {state.done} card{state.done !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => reviewSession.addMoreNewCards()}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent"
          >
            More New Cards
          </button>
          <button
            onClick={handleEnd}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!card) return null;

  const cardState = cardStore.getState(deck, card.id);
  const isNewCard = cardState.reps === 0;

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handleEnd}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          End Session
        </button>
        <span className="text-sm text-muted-foreground">
          {state.done + 1} / {state.total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-secondary rounded-full mb-8">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${(state.done / state.total) * 100}%` }}
        />
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {isNewCard && (
          <span className="text-xs font-medium text-green-500 uppercase tracking-wider">
            New
          </span>
        )}

        <div className="text-center">
          <p className="text-3xl font-bold">{card.source}</p>
          {card.isReverse && (
            <p className="text-xs text-muted-foreground mt-1">reverse</p>
          )}
        </div>

        {state.answerRevealed ? (
          <div className="text-center space-y-3 animate-in fade-in">
            <p className="text-xl">{card.translation}</p>
            {card.example && (
              <p className="text-sm text-muted-foreground italic">
                {card.example}
              </p>
            )}
            {card.notes && (
              <p className="text-sm text-muted-foreground">{card.notes}</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => reviewSession.showAnswer()}
            className="rounded-md border border-input px-6 py-3 text-sm font-medium hover:bg-accent"
          >
            Show Answer
          </button>
        )}
      </div>

      {/* Rating buttons */}
      {state.answerRevealed && (
        <div className="grid grid-cols-4 gap-2 mt-8 pb-4">
          <button
            onClick={() => handleRate(Rating.Again)}
            disabled={rating}
            className="rounded-md bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-3 text-sm font-medium hover:bg-red-500/20 disabled:opacity-50"
          >
            Again
          </button>
          <button
            onClick={() => handleRate(Rating.Hard)}
            disabled={rating}
            className="rounded-md bg-orange-500/10 text-orange-500 border border-orange-500/20 px-2 py-3 text-sm font-medium hover:bg-orange-500/20 disabled:opacity-50"
          >
            Hard
          </button>
          <button
            onClick={() => handleRate(Rating.Good)}
            disabled={rating}
            className="rounded-md bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-3 text-sm font-medium hover:bg-green-500/20 disabled:opacity-50"
          >
            Good
          </button>
          <button
            onClick={() => handleRate(Rating.Easy)}
            disabled={rating}
            className="rounded-md bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-3 text-sm font-medium hover:bg-blue-500/20 disabled:opacity-50"
          >
            Easy
          </button>
        </div>
      )}
    </div>
  );
}
