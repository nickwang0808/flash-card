import type { Rating } from '@/domain/primitives';
import { Button, ButtonText } from '@/components/ui/button';

const labelByRating: Record<Rating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const classByRating: Record<Rating, string> = {
  again: 'bg-red-700 data-[hover=true]:bg-red-800 data-[active=true]:bg-red-800',
  hard: 'bg-orange-700 data-[hover=true]:bg-orange-800 data-[active=true]:bg-orange-800',
  good: 'bg-green-700 data-[hover=true]:bg-green-800 data-[active=true]:bg-green-800',
  easy: 'bg-blue-700 data-[hover=true]:bg-blue-800 data-[active=true]:bg-blue-800',
};

interface RatingButtonProps {
  rating: Rating;
  disabled?: boolean;
  onPress(rating: Rating): void;
}

export function RatingButton({ rating, disabled, onPress }: RatingButtonProps) {
  return <Button accessibilityLabel={labelByRating[rating]} className={`flex-1 ${classByRating[rating]}`} isDisabled={disabled} onPress={() => onPress(rating)} testID={`rating-${rating}`}><ButtonText className="text-white">{labelByRating[rating]}</ButtonText></Button>;
}
