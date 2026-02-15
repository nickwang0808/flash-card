import { useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { Rating, type Grade } from 'ts-fsrs';
import { useDeck } from '../hooks/useDeck';
import { useTts } from '../hooks/useTts';
import { TtsLocalePicker } from './TtsLocalePicker';

interface Props {
  deck: string;
  onBack: () => void;
}

export function ReviewScreen({ deck, onBack }: Props) {
  const { currentCard, remaining, rate, suspend, undo, canUndo, isLoading } = useDeck(deck);
  const { speak, showPicker, selectLocale, dismissPicker, voices } = useTts(deck);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [cardKey, setCardKey] = useState(0);

  function handleRate(rating: Grade) {
    rate(rating);
    setAnswerRevealed(false);
    setCardKey(k => k + 1);
  }

  if (isLoading) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <p className="text-muted-foreground">Loading cards...</p>
      </div>
    );
  }

  if (!currentCard) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center p-4 gap-4">
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
    <div className="h-dvh flex flex-col p-4 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          End Session
        </button>
        <div className="flex items-center gap-3">
          {canUndo && (
            <button
              onClick={undo}
              className="text-sm text-muted-foreground hover:text-foreground"
              title="Undo last rating"
            >
              Undo
            </button>
          )}
          <button
            onClick={() => { suspend(); setAnswerRevealed(false); setCardKey(k => k + 1); }}
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
      <div key={cardKey} className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 overflow-y-auto animate-fade-in">
        {currentCard.isNew && (
          <span className="text-xs font-medium text-green-500 uppercase tracking-wider">
            New
          </span>
        )}

        <div className="text-center" data-testid="card-front">
          <div className="flex items-center justify-center gap-2">
            <div className="card-markdown"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{currentCard.front}</Markdown></div>
            {!currentCard.isReverse && (
              <button
                onClick={() => speak(currentCard.term)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                title="Speak term"
                data-testid="tts-button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              </button>
            )}
          </div>
          {currentCard.isReverse && (
            <p className="text-xs text-muted-foreground mt-1">reverse</p>
          )}
        </div>

        {answerRevealed ? (
          <div className="text-center space-y-3 animate-fade-in" data-testid="card-back">
            <div className="flex items-center justify-center gap-2">
              <div><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{currentCard.back}</Markdown></div>
              {currentCard.isReverse && (
                <button
                  onClick={() => speak(currentCard.term)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="Speak term"
                  data-testid="tts-button"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                </button>
              )}
            </div>
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
        <div className="grid grid-cols-4 gap-2 pt-4 pb-4 shrink-0">
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

      {showPicker && (
        <TtsLocalePicker
          voices={voices}
          onSelect={selectLocale}
          onDismiss={dismissPicker}
        />
      )}
    </div>
  );
}
