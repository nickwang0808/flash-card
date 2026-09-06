import type { Rating } from '@/domain/primitives';
import { Button, ButtonText } from '@/components/ui/button';

const labelByRating: Record<Rating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const classByRating: Record<Rating, string> = { again: 'bg-red-600', hard: 'bg-orange-500', good: 'bg-green-600', easy: 'bg-blue-600' };

interface RatingButtonProps {
  rating: Rating;
  disabled?: boolean;
  onPress(rating: Rating): void;
}

export function RatingButton({ rating, disabled, onPress }: RatingButtonProps) {
  return <Button accessibilityLabel={labelByRating[rating]} className={`flex-1 ${classByRating[rating]}`} isDisabled={disabled} onPress={() => onPress(rating)} testID={`rating-${rating}`}><ButtonText>{labelByRating[rating]}</ButtonText></Button>;
}
