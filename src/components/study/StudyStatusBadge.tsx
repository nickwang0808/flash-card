import { Badge, BadgeText } from '@/components/ui/badge';
import type { QueueItem } from '@/features/study/useStudySession';

export function StudyStatusBadge({ status }: Pick<QueueItem, 'status'>) {
  const isNew = status === 'new';
  return <Badge className={`self-start ${isNew ? 'bg-green-600' : 'bg-orange-500'}`}><BadgeText>{isNew ? 'New' : 'Review'}</BadgeText></Badge>;
}
