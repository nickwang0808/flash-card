import { Badge, BadgeText } from '@/components/ui/badge';
import type { QueueItem } from '@/features/study/useStudySession';

const labelByStatus: Record<QueueItem['status'], string> = { new: 'New', due: 'Due', future: 'Future' };

export function StudyStatusBadge({ status }: Pick<QueueItem, 'status'>) {
  return <Badge className={status === 'new' ? 'bg-green-600' : status === 'due' ? 'bg-orange-500' : 'bg-blue-600'}><BadgeText>{labelByStatus[status]}</BadgeText></Badge>;
}
