import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/api/ApiProvider';
import type { Rating } from '@/domain/primitives';
import type { QueueSnapshot } from '@/domain/StudyQueue';
import { STUDY_QUEUE_LIMIT, queryKeys } from '@/query/keys';

export type QueueItem = QueueSnapshot['items'][number];

interface RatingCommand {
  card: QueueItem;
  rating: Rating;
  requestId: string;
}

interface UndoToken {
  reviewId: string;
  cadenceId: string;
}

export interface StudySession {
  activeCard: QueueItem | null;
  answerRevealed: boolean;
  reviewCount: number;
  newCount: number;
  pendingRatings: number;
  phase: 'loading' | 'error' | 'ready' | 'saving' | 'complete';
  error: Error | null;
  canUndo: boolean;
  reveal(): void;
  rate(rating: Rating): void;
  undo(): void;
  refetch(): Promise<unknown>;
}

const mutationKey = (deckId: string) => ['review-rate', deckId] as const;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unable to save review');
}

export function useStudySession(deckId: string): StudySession {
  const api = useApi();
  const queryClient = useQueryClient();
  const queueKey = queryKeys.studyQueue(deckId, STUDY_QUEUE_LIMIT);
  const [activeCard, setActiveCard] = useState<QueueItem | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [undoToken, setUndoToken] = useState<UndoToken | null>(null);
  const [suppressedIds, setSuppressedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [claimedIds, setClaimedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  const claimedRef = useRef(new Set<string>());

  const queue = useQuery({
    queryKey: queueKey,
    queryFn: () => api.deck.queue.query({ deckId, limit: STUDY_QUEUE_LIMIT }),
    enabled: Boolean(deckId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const pendingCommands = useMutationState({
    filters: { mutationKey: mutationKey(deckId), status: 'pending' },
    select: (mutation) => mutation.state.variables as RatingCommand,
  });
  const pendingIds = useMemo(() => new Set([...claimedIds, ...pendingCommands.map((command) => command.card.id)]), [claimedIds, pendingCommands]);
  const hiddenIds = useMemo(() => new Set([...pendingIds, ...suppressedIds]), [pendingIds, suppressedIds]);
  const snapshot = queue.data;
  const visibleItems = useMemo(() => snapshot?.items.filter((item) => !hiddenIds.has(item.id)) ?? [], [hiddenIds, snapshot]);

  const installQueue = useCallback((next: QueueSnapshot) => {
    queryClient.setQueryData(queueKey, next);
  }, [queryClient, queueKey]);

  const releaseClaim = useCallback((cardId: string) => {
    claimedRef.current.delete(cardId);
    setClaimedIds((current) => {
      if (!current.has(cardId)) return current;
      const next = new Set(current);
      next.delete(cardId);
      return next;
    });
  }, []);

  const refetch = useCallback(async () => {
    const result = await queue.refetch();
    if (result.error) throw result.error;
    return result.data;
  }, [queue]);

  const rating = useMutation({
    mutationKey: mutationKey(deckId),
    scope: { id: `study:${deckId}` },
    retry: false,
    mutationFn: (command: RatingCommand) => api.review.rate.mutate({
      cadenceId: command.card.id,
      deckId,
      rating: command.rating,
      expectedVersion: command.card.version,
      requestId: command.requestId,
      queue: { limit: STUDY_QUEUE_LIMIT },
    }),
    onSuccess: (result, command) => {
      installQueue(result.queue);
      setUndoToken({ reviewId: result.reviewId, cadenceId: command.card.id });
      setRefreshError(null);
    },
    onError: async (cause, command) => {
      setUndoToken(null);
      setSuppressedIds((current) => new Set(current).add(command.card.id));
      setRefreshError(asError(cause));
      try {
        await refetch();
        setSuppressedIds((current) => {
          const next = new Set(current);
          next.delete(command.card.id);
          return next;
        });
        setRefreshError(null);
      } catch (refetchCause) {
        setRefreshError(asError(refetchCause));
      }
    },
    onSettled: (_result, _error, command) => releaseClaim(command.card.id),
  });

  const undoMutation = useMutation({
    mutationKey: ['review-undo', deckId],
    scope: { id: `study:${deckId}` },
    retry: false,
    mutationFn: (token: UndoToken) => api.review.undo.mutate({ reviewId: token.reviewId, deckId, queue: { limit: STUDY_QUEUE_LIMIT } }),
    onSuccess: (result, token) => {
      installQueue(result.queue);
      setUndoToken(null);
      setAnswerRevealed(false);
      setActiveCard(result.queue.items.find((item) => item.id === token.cadenceId) ?? null);
      setRefreshError(null);
    },
    onError: async (cause) => {
      setUndoToken(null);
      setRefreshError(asError(cause));
      try {
        await refetch();
      } catch (refetchCause) {
        setRefreshError(asError(refetchCause));
      }
    },
  });

  useEffect(() => {
    if (activeCard || !visibleItems.length) return;
    setActiveCard(visibleItems[0]);
  }, [activeCard, visibleItems]);

  const rate = useCallback((value: Rating) => {
    const card = activeCard;
    if (!card || claimedRef.current.has(card.id) || (undoMutation.isPending && undoToken?.cadenceId === card.id)) return;
    const command: RatingCommand = { card, rating: value, requestId: randomUUID() };
    claimedRef.current.add(card.id);
    setClaimedIds((current) => new Set(current).add(card.id));
    setAnswerRevealed(false);
    const latest = queryClient.getQueryData<QueueSnapshot>(queueKey);
    const next = latest?.items.find((item) => item.id !== card.id && !hiddenIds.has(item.id)) ?? null;
    setActiveCard(next);
    rating.mutate(command);
  }, [activeCard, hiddenIds, queryClient, queueKey, rating, undoMutation.isPending, undoToken]);

  const undo = useCallback(() => {
    if (!undoToken || pendingCommands.length || undoMutation.isPending) return;
    undoMutation.mutate(undoToken);
  }, [pendingCommands.length, undoMutation, undoToken]);

  const pendingRatings = Math.max(pendingCommands.length, claimedIds.size);
  const reviewCount = snapshot?.counts.review ?? 0;
  const newCount = snapshot?.counts.new ?? 0;
  const error = queue.isError ? asError(queue.error) : refreshError;
  const phase: StudySession['phase'] = queue.isPending ? 'loading'
    : !activeCard && queue.isError ? 'error'
    : activeCard ? 'ready'
    : pendingRatings || undoMutation.isPending ? 'saving'
    : 'complete';

  return {
    activeCard,
    answerRevealed,
    reviewCount,
    newCount,
    pendingRatings,
    phase,
    error,
    canUndo: Boolean(undoToken) && pendingRatings === 0 && !undoMutation.isPending,
    reveal: () => setAnswerRevealed(true),
    rate,
    undo,
    refetch,
  };
}
