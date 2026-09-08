import { View } from 'react-native';

import type { Rating } from '@/domain/primitives';

import { RatingButton } from './RatingButton';

interface RatingBarProps {
  disabled?: boolean;
  onRate(rating: Rating): void;
}

export function RatingBar({ disabled, onRate }: RatingBarProps) {
  return <View className="flex-row gap-2"><RatingButton disabled={disabled} onPress={onRate} rating="again" /><RatingButton disabled={disabled} onPress={onRate} rating="hard" /><RatingButton disabled={disabled} onPress={onRate} rating="good" /><RatingButton disabled={disabled} onPress={onRate} rating="easy" /></View>;
}
