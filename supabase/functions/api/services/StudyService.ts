import type { PaginationInput, PageInfo } from '../../../../src/api/pagination.ts';
import { Cadence } from '../../../../src/domain/Cadence.ts';
import type { CadenceState } from '../../../../src/domain/CadenceState.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { Rating } from '../../../../src/domain/primitives.ts';
import { QueueOptionsSchema, StudyQueue, type QueueOptions, type QueueSnapshot } from '../../../../src/domain/StudyQueue.ts';
import type { ReviewHistoryEntry } from '../../../../src/domain/ReviewEvent.ts';
import type { StudyRepository } from '../repositories/StudyRepository.ts';
import { cadenceStateOf, ReviewRequestExists } from '../repositories/StudyRepository.ts';

/**
 * The complete study workflow: queue construction, atomic rating with
 * idempotency and optimistic concurrency, review history, and exact undo.
 * Cadence and queue policies are the pure domain objects.
 *
 * Every queue-affecting mutation commits first, then builds the replacement
 * snapshot against the committed state; the snapshot is never read mid-
 * transaction with a separate client.
 */
export class StudyService {
  constructor(
    private readonly study: StudyRepository,
    private readonly queue: StudyQueue = new StudyQueue(),
    private readonly cadence: Cadence = new Cadence(),
  ) {}

  /** Build the authoritative queue snapshot for one owned deck. */
  async getQueue(input: { deckId: string; options: Partial<QueueOptions>; now?: Date }): Promise<QueueSnapshot> {
    const now = input.now ?? new Date();
    const options = this.normalizeOptions(input.options);
    if (!(await this.study.deckOwned(input.deckId))) {
      throw new ApplicationError('NOT_FOUND', 'Deck not found');
    }
    return this.buildQueueSnapshot(input.deckId, options, now);
  }

  /**
   * Rate one owned card in a single transaction: lock, stale-version reject,
   * request-id idempotency, cadence transition, event insert (before/after),
   * card cadence update. Commit, then return the review ID and a fresh queue
   * snapshot built from the committed state. A concurrent request with the
   * same request_id that wins the unique-key race is resolved after the
   * aborted transaction by re-reading the committed event.
   */
  async rate(input: {
    cardId: string;
    deckId: string;
    rating: Rating;
    expectedVersion: number;
    requestId: string;
    queue: Partial<QueueOptions>;
    now?: Date;
  }): Promise<{ reviewId: string; queue: QueueSnapshot }> {
    const now = input.now ?? new Date();
    const options = this.normalizeOptions(input.queue);

    let reviewId: string;
    try {
      reviewId = await this.study.transaction(async (tx) => {
        if (!(await this.study.deckOwned(input.deckId))) {
          throw new ApplicationError('NOT_FOUND', 'Deck not found');
        }
        const card = await this.study.lockCardForUpdate(tx, input.cardId, input.deckId);
        if (!card) {
          throw new ApplicationError('NOT_FOUND', 'Card not found');
        }

        const existing = await this.study.findReviewByRequest(tx, input.cardId, input.requestId);
        if (existing) {
          return existing.id;
        }

        if (card.version !== input.expectedVersion) {
          throw new ApplicationError('CONFLICT', `Card changed since version ${input.expectedVersion}`);
        }

        const beforeState = cadenceStateOf(card);
        const afterState = this.cadence.rate(beforeState, input.rating, now);

        const { event } = await this.study.insertReviewEvent(tx, {
          cardId: input.cardId,
          rating: input.rating,
          reviewedAt: now,
          beforeState,
          afterState,
          requestId: input.requestId,
        });
        await this.study.setCardCadenceState(tx, input.cardId, afterState);

        return event.id;
      });
    } catch (error) {
      if (error instanceof ReviewRequestExists) {
        const existing = await this.study.findReviewByIdempotencyKey(input.cardId, input.requestId);
        if (!existing) {
          throw new ApplicationError('INTERNAL', 'Review request conflicted but no event exists');
        }
        reviewId = existing.id;
      } else {
        throw error;
      }
    }

    return {
      reviewId,
      queue: await this.buildQueueSnapshot(input.deckId, options, now),
    };
  }

  /** Newest-first review history for one owned card, undone events included. */
  async getHistory(input: {
    cardId: string;
    deckId: string;
    pagination: PaginationInput;
  }): Promise<{ events: ReviewHistoryEntry[]; pageInfo: PageInfo }> {
    return this.study.getHistory(input);
  }

  /**
   * Undo the selected review only when it is the latest active review for the
   * card. Restores the exact stored before_state and marks the event undone,
   * then returns a fresh queue snapshot built from the committed state.
   */
  async undo(input: { reviewId: string; deckId: string; queue: Partial<QueueOptions>; now?: Date }): Promise<QueueSnapshot> {
    const now = input.now ?? new Date();
    const options = this.normalizeOptions(input.queue);

    await this.study.transaction(async (tx) => {
      if (!(await this.study.deckOwned(input.deckId))) {
        throw new ApplicationError('NOT_FOUND', 'Deck not found');
      }
      const event = await this.study.lockReviewForUpdate(tx, input.reviewId, input.deckId);
      if (!event) {
        throw new ApplicationError('NOT_FOUND', 'Review not found');
      }
      if (event.undoneAt !== null) {
        throw new ApplicationError('INVALID_STATE', 'Review is already undone');
      }

      const latest = await this.study.isLatestActiveReview(tx, event.cardId, new Date(event.reviewedAt), event.id);
      if (!latest) {
        throw new ApplicationError('INVALID_STATE', 'Only the latest active review can be undone');
      }

      const beforeState: CadenceState = event.beforeState ?? {
        cadencePhase: null,
        nextReviewAt: null,
        intervalDays: null,
        reviewCount: 0,
        lapseCount: 0,
        schedulerVersion: null,
      };
      await this.study.markEventUndone(tx, event.id, now);
      await this.study.setCardCadenceState(tx, event.cardId, beforeState);
    });

    return this.buildQueueSnapshot(input.deckId, options, now);
  }

  private normalizeOptions(options: Partial<QueueOptions>): QueueOptions {
    return QueueOptionsSchema.parse(options);
  }

  private async buildQueueSnapshot(deckId: string, options: QueueOptions, now: Date): Promise<QueueSnapshot> {
    const { newCards, reviewedCards } = await this.study.queueBuckets({
      deckId,
      now,
      horizonMs: options.horizonHours * 3_600_000,
      limit: options.limit,
    });
    return this.queue.build([...newCards, ...reviewedCards], now, options);
  }
}