import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewScreen } from '../../src/components/ReviewScreen';

const mockUseDeck = vi.fn();
vi.mock('../../src/hooks/useDeck', () => ({
  useDeck: (...args: unknown[]) => mockUseDeck(...args),
}));

vi.mock('../../src/hooks/useTts', () => ({
  useTts: () => ({
    speak: vi.fn(),
    showPicker: false,
    selectLocale: vi.fn(),
    dismissPicker: vi.fn(),
    voices: [],
  }),
}));

function setCurrentCard(card: { term: string; front: string; back: string; isReverse: boolean }) {
  mockUseDeck.mockReturnValue({
    currentCard: { ...card, isNew: false },
    remaining: 1,
    rate: vi.fn(),
    suspend: vi.fn(),
    undo: vi.fn(),
    canUndo: false,
    isLoading: false,
  });
}

describe('TTS button placement', () => {
  it('shows TTS button on front for normal card', () => {
    setCurrentCard({ term: 'hola', front: 'hola', back: 'hello', isReverse: false });
    render(<ReviewScreen deck="test" onBack={() => {}} />);

    const front = screen.getByTestId('card-front');
    expect(front.querySelector('[data-testid="tts-button"]')).toBeInTheDocument();
  });

  it('hides TTS button from front on reverse card', () => {
    setCurrentCard({ term: 'hola', front: 'hello', back: 'hola', isReverse: true });
    render(<ReviewScreen deck="test" onBack={() => {}} />);

    const front = screen.getByTestId('card-front');
    expect(front.querySelector('[data-testid="tts-button"]')).not.toBeInTheDocument();
  });

  it('shows TTS button on back after reveal for reverse card', () => {
    setCurrentCard({ term: 'hola', front: 'hello', back: 'hola', isReverse: true });
    render(<ReviewScreen deck="test" onBack={() => {}} />);

    fireEvent.click(screen.getByText('Show Answer'));

    const back = screen.getByTestId('card-back');
    expect(back.querySelector('[data-testid="tts-button"]')).toBeInTheDocument();
  });
});
