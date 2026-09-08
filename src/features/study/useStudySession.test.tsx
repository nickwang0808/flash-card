// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';
import type { QueueSnapshot } from '@/domain/StudyQueue';

const state = vi.hoisted(() => ({ api: null as ApiClient | null }));
vi.mock('@/api/ApiProvider', () => ({ useApi: () => state.api }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn().mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('00000000-0000-4000-8000-000000000002').mockReturnValue('00000000-0000-4000-8000-000000000003') }));

import { useStudySession } from './useStudySession';

const deckId = '00000000-0000-4000-8000-000000000010';
const cards = ['A', 'B', 'C'].map((name, index) => ({
  id: `00000000-0000-4000-8000-0000000000${20 + index}`,
  cardId: `00000000-0000-4000-8000-0000000000${30 + index}`,
  deckId,
  name,
  frontMarkdown: `front ${name}`,
  backMarkdown: `back ${name}`,
  speechText: null,
  speechLocale: null,
  speechSide: null,
  tags: [],
  reversible: false,
  suspended: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  direction: 'forward' as const,
  nextReviewAt: null,
  intervalDays: null,
  reviewCount: 0,
  lapseCount: 0,
  version: index,
  status: 'new' as const,
}));

function snapshot(items = cards, counts = {
  review: items.filter((item) => item.status !== 'new').length,
  new: items.filter((item) => item.status === 'new').length,
}): QueueSnapshot {
  return { asOf: '2026-01-01T00:00:00.000Z', horizon: '2026-01-01T12:00:00.000Z', counts, items };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createHarness(initial = snapshot()) {
  const first = deferred<{ reviewId: string; queue: QueueSnapshot }>();
  const second = deferred<{ reviewId: string; queue: QueueSnapshot }>();
  const rate = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  state.api = {
    deck: { queue: { query: vi.fn().mockResolvedValue(initial) } },
    review: { rate: { mutate: rate }, undo: { mutate: vi.fn() } },
  } as unknown as ApiClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { first, second, rate, wrapper };
}

describe('useStudySession', () => {
  it('advances optimistic cards while serializing ratings on the wire', async () => {
    const harness = createHarness();
    const { result } = renderHook(() => useStudySession(deckId), { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.activeCard?.name).toBe('A'));
    expect(result.current).toMatchObject({ reviewCount: 0, newCount: 3 });

    act(() => result.current.rate('good'));
    expect(result.current.activeCard?.name).toBe('B');
    await waitFor(() => expect(harness.rate).toHaveBeenCalledTimes(1));
    expect(harness.rate.mock.calls[0][0]).toMatchObject({ cadenceId: cards[0].id, expectedVersion: 0, requestId: '00000000-0000-4000-8000-000000000001' });

    act(() => result.current.rate('easy'));
    expect(result.current.activeCard?.name).toBe('C');
    expect(harness.rate).toHaveBeenCalledTimes(1);

    await act(async () => harness.first.resolve({ reviewId: '00000000-0000-4000-8000-000000000041', queue: snapshot([cards[2], { ...cards[0], version: 1 }]) }));
    await waitFor(() => expect(harness.rate).toHaveBeenCalledTimes(2));
    expect(result.current.activeCard?.name).toBe('C');
    expect(harness.rate.mock.calls[1][0]).toMatchObject({ cadenceId: cards[1].id, expectedVersion: 1, requestId: '00000000-0000-4000-8000-000000000002' });
  });

  it('suppresses a double tap and shows saving before authoritative completion', async () => {
    const harness = createHarness();
    const { result } = renderHook(() => useStudySession(deckId), { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.activeCard?.name).toBe('A'));

    act(() => { result.current.rate('good'); result.current.rate('easy'); });
    await waitFor(() => expect(harness.rate).toHaveBeenCalledTimes(1));
    expect(result.current.activeCard?.name).toBe('B');

    await act(async () => harness.first.resolve({ reviewId: '00000000-0000-4000-8000-000000000042', queue: snapshot([cards[1]]) }));
    await waitFor(() => expect(result.current.activeCard?.name).toBe('B'));
    act(() => result.current.rate('good'));
    expect(result.current.phase).toBe('saving');
    await act(async () => harness.second.resolve({ reviewId: '00000000-0000-4000-8000-000000000043', queue: snapshot([]) }));
    await waitFor(() => expect(result.current.phase).toBe('complete'));
  });
});
