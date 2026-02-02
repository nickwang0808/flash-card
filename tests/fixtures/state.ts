import type { CardState } from '../../src/utils/fsrs';

export const testState: Record<string, CardState> = {
  'hola': {
    due: '2025-02-01T00:00:00Z',
    stability: 2.5,
    difficulty: 0.3,
    elapsed_days: 3,
    scheduled_days: 4,
    reps: 3,
    lapses: 0,
    state: 2, // Review
    last_review: '2025-01-28T10:00:00Z',
    suspended: false,
  },
  'gato': {
    due: '2025-02-03T00:00:00Z',
    stability: 5.0,
    difficulty: 0.25,
    elapsed_days: 5,
    scheduled_days: 7,
    reps: 4,
    lapses: 0,
    state: 2,
    last_review: '2025-01-29T10:00:00Z',
    suspended: false,
  },
};

export const testStateJson = JSON.stringify(testState, null, 2);
