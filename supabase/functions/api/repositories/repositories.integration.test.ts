import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../../src/types/supabase.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import { createTestUser, deleteUserByEmail, deleteTestUser, localStackEnv } from '../../../../supabase/migrations/local-stack.test-support.ts';
import { Cadence } from '../../../../src/domain/Cadence.ts';
import { StudyQueue } from '../../../../src/domain/StudyQueue.ts';
import { StudyService } from '../services/StudyService.ts';
import { PostgresDeckRepository } from './DeckRepository.ts';
import { PostgresCardRepository } from './CardRepository.ts';
import { PostgresStudyRepository } from './StudyRepository.ts';
import { newCardState } from './mappers.ts';
import { getDb, type AppDbWithPool } from '../../../../src/db/client.ts';
import { reviewEvents } from '../../../../src/db/schema.ts';
import { eq } from 'drizzle-orm';

const env = localStackEnv();
const EMAIL_A = 'repo-test-a@example.com';
const EMAIL_B = 'repo-test-b@example.com';

let sql: AppDbWithPool;
let userIdA: string;
let userIdB: string;
let sequence = 0;
const uniqueDeckName = (base: string) => `${base}-${++sequence}`;

/** Repos bound to user A; cross-tenant assertions build repos for user B. */
function reposFor(userId: string) {
  return {
    decks: new PostgresDeckRepository(sql, userId),
    cards: new PostgresCardRepository(sql, userId),
    study: new PostgresStudyRepository(sql, userId),
  };
}

beforeAll(async () => {
  const admin = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  await deleteUserByEmail(admin, EMAIL_A);
  await deleteUserByEmail(admin, EMAIL_B);
  const [userA, userB] = await Promise.all([createTestUser(admin, EMAIL_A), createTestUser(admin, EMAIL_B)]);
  userIdA = userA.id;
  userIdB = userB.id;
  sql = getDb(env.DATABASE_URL!);
});

afterAll(async () => {
  const admin = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  await Promise.all([deleteTestUser(admin, userIdA), deleteTestUser(admin, userIdB)]);
  await sql.$client.end?.();
});

describe('DeckRepository', () => {
  it('creates, lists, renames, and removes tenant-scoped decks', async () => {
    const name = uniqueDeckName('Spanish');
    const a = reposFor(userIdA);
    const created = await a.decks.create({ name, defaultSpeechLocale: 'es' });
    expect(created.defaultSpeechLocale).toBe('es');

    // Unique per user.
    await expect(a.decks.create({ name, defaultSpeechLocale: null })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    // Same name is fine for a different user.
    const b = reposFor(userIdB);
    await expect(b.decks.create({ name, defaultSpeechLocale: null })).resolves.toMatchObject({ name });

    const renamed = await a.decks.rename(created.id, `${name}ñol`, 0);
    expect(renamed.name).toBe(`${name}ñol`);
    expect(renamed.version).toBe(1);
    await expect(a.decks.rename(created.id, 'x', 0)).rejects.toMatchObject({ code: 'CONFLICT' });

    // list is scoped and deterministic.
    const listedA = await a.decks.list();
    expect(listedA.map((d) => d.name)).toEqual([`${name}ñol`]);
    const listedB = await b.decks.list();
    expect(listedB.map((d) => d.name)).toEqual([name]);

    await expect(a.decks.remove(created.id, 1)).resolves.toBeUndefined();
  });
});

describe('CardRepository', () => {
  async function seeded() {
    const a = reposFor(userIdA);
    const deck = await a.decks.create({ name: uniqueDeckName('Vocab'), defaultSpeechLocale: null });
    const content = {
      name: 'Hola',
      frontMarkdown: 'Hello',
      backMarkdown: 'Hola',
      speechText: 'hola',
      speechLocale: 'es',
    };
    const card = await a.cards.create({ deckId: deck.id, content, tags: ['greeting'] });
    return { a, deck, card, content };
  }

  it('creates a card with its initial revision', async () => {
    const { a, card } = await seeded();
    expect(card.name).toBe('Hola');
    const revisions = await a.cards.revisions({ cardId: card.id, deckId: card.deckId, pagination: { limit: 10 } });
    expect(revisions.revisions).toHaveLength(1);
    expect(revisions.revisions[0].eventType).toBe('created');
    expect(revisions.revisions[0].beforeContent).toBeNull();
  });

  it('updates content and records before/after revisions', async () => {
    const { a, deck, card } = await seeded();
    const updated = await a.cards.update({
      cardId: card.id,
      deckId: deck.id,
      expectedVersion: 0,
      content: { name: 'Hola!', frontMarkdown: 'Hello there', backMarkdown: 'Hola!', speechText: null, speechLocale: null },
      tags: [],
    });
    expect(updated.version).toBe(1);
    const revisions = await a.cards.revisions({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(revisions.revisions).toHaveLength(2);
    expect(revisions.revisions[0].eventType).toBe('edited');
    expect(revisions.revisions[0].beforeContent?.frontMarkdown).toBe('Hello');
    expect(revisions.revisions[0].afterContent?.frontMarkdown).toBe('Hello there');
  });

  it('rejects stale versions and missing ownership', async () => {
    const { a, deck, card } = await seeded();
    await expect(
      a.cards.update({
        cardId: card.id,
        deckId: deck.id,
        expectedVersion: 9,
        content: { name: 'x', frontMarkdown: 'x', backMarkdown: 'x', speechText: null, speechLocale: null },
        tags: [],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const b = reposFor(userIdB);
    await expect(b.cards.get(card.id, deck.id)).resolves.toBeNull();
    await expect(
      b.cards.setSuspended({ cardId: card.id, deckId: deck.id, expectedVersion: 1, suspended: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('searches by name, markdown, and tag scoped to the caller', async () => {
    const { a, deck, card } = await seeded();
    const byTag = await a.cards.search({ deckId: deck.id, query: 'greeting', pagination: { limit: 10 } });
    expect(byTag.cards.map((c) => c.id)).toEqual([card.id]);
    const byFront = await a.cards.search({ deckId: deck.id, query: 'hello', pagination: { limit: 10 } });
    expect(byFront.cards).toHaveLength(1);
    const byName = await a.cards.search({ deckId: deck.id, query: 'hola', pagination: { limit: 10 } });
    expect(byName.cards).toHaveLength(1);
  });

  it('rolls back to a historical revision as a new revision', async () => {
    const { a, deck, card } = await seeded();
    await a.cards.update({
      cardId: card.id,
      deckId: deck.id,
      expectedVersion: 0,
      content: { name: 'Changed', frontMarkdown: 'front2', backMarkdown: 'back2', speechText: null, speechLocale: null },
      tags: [],
    });
    const revisions = await a.cards.revisions({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } });
    const original = revisions.revisions[1]; // created revision, newest-first
    const rolled = await a.cards.rollbackRevision({
      cardId: card.id,
      deckId: deck.id,
      revisionId: original.id,
      expectedVersion: 1,
    });
    expect(rolled.name).toBe('Hola');
    expect(rolled.cadencePhase).toBeNull(); // cadence untouched

    const after = await a.cards.revisions({ cardId: card.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(after.revisions[0].eventType).toBe('restored');
  });
});

describe('StudyRepository', () => {
  async function seededDeckWithCards() {
    const a = reposFor(userIdA);
    const deck = await a.decks.create({ name: uniqueDeckName('Study'), defaultSpeechLocale: null });
    const newCard = await a.cards.create({
      deckId: deck.id,
      content: { name: 'n1', frontMarkdown: 'f', backMarkdown: 'b', speechText: null, speechLocale: null },
      tags: [],
    });
    return { a, deck, newCard };
  }

  it('orders the queue new-first with the reviewed horizon', async () => {
    const { a, deck, newCard } = await seededDeckWithCards();
    const now = new Date('2026-09-04T12:00:00.000Z');
    const horizon = 48;

    // Seed a reviewed card due inside the horizon and one beyond it.
    const inside = await a.cards.create({
      deckId: deck.id,
      content: { name: 'n2', frontMarkdown: 'f', backMarkdown: 'b', speechText: null, speechLocale: null },
      tags: [],
    });
    const far = await a.cards.create({
      deckId: deck.id,
      content: { name: 'n3', frontMarkdown: 'f', backMarkdown: 'b', speechText: null, speechLocale: null },
      tags: [],
    });
    const studied = {
      cadencePhase: 'review' as const,
      intervalDays: 1,
      reviewCount: 1,
      lapseCount: 0,
      schedulerVersion: 1,
    };
    await a.study.transaction(async (tx) => {
      await a.study.setCardCadenceState(tx, inside.id, { ...studied, nextReviewAt: '2026-09-05T00:00:00.000Z' }, 0);
      await a.study.setCardCadenceState(tx, far.id, { ...studied, intervalDays: 20, nextReviewAt: '2026-09-20T00:00:00.000Z' }, 0);
    });

    const buckets = await a.study.queueBuckets({ deckId: deck.id, now, horizonMs: horizon * 3_600_000, limit: 10 });
    expect(buckets.newCards.map((c) => c.id)).toEqual([newCard.id]);
    expect(buckets.reviewedCards.map((c) => c.id)).toEqual([inside.id]); // far is beyond the horizon
  });

  it('commits a rating transaction and makes replay idempotent', async () => {
    const { a, deck, newCard } = await seededDeckWithCards();
    const now = new Date('2026-09-04T12:00:00.000Z');
    const requestId = '00000000-0000-4000-8000-0000000000a1';
    const before = newCardState();

    const outcome = await a.study.transaction(async (tx) => {
      const card = await a.study.lockCardForUpdate(tx, newCard.id, deck.id);
      expect(card).not.toBeNull();
      const after = { ...before, cadencePhase: 'review' as const, nextReviewAt: '2026-09-05T12:00:00.000Z', intervalDays: 1, reviewCount: 1, schedulerVersion: 1 };
      const inserted = await a.study.insertReviewEvent(tx, {
        cardId: newCard.id,
        rating: 'good',
        reviewedAt: now,
        beforeState: before,
        afterState: after,
        requestId,
      });
      await a.study.setCardCadenceState(tx, newCard.id, after, 0);
      return { inserted, after };
    });

    expect(outcome.inserted).toBeDefined();

    // Replay through the service: same request_id must not apply twice.
    const service = new StudyService(a.study, new StudyQueue(), new Cadence());
    const replay = await service.rate({
      cardId: newCard.id,
      deckId: deck.id,
      rating: 'good',
      expectedVersion: 1,
      requestId,
      queue: { horizonHours: 48, limit: 50 },
      now,
    });
    expect(replay.reviewId).toBe(outcome.inserted.id);
    const card = await a.cards.get(newCard.id, deck.id);
    expect(card?.reviewCount).toBe(1); // applied exactly once
    expect(card?.version).toBe(1);
  });

  it('rolls back the whole transaction when a step fails', async () => {
    const { a, deck, newCard } = await seededDeckWithCards();
    const before = newCardState();
    const after = { ...before, cadencePhase: 'review' as const, nextReviewAt: '2026-09-05T12:00:00.000Z', intervalDays: 1, reviewCount: 1, schedulerVersion: 1 };

    await expect(
      a.study.transaction(async (tx) => {
        await a.study.insertReviewEvent(tx, {
          cardId: newCard.id,
          rating: 'good',
          reviewedAt: new Date(),
          beforeState: before,
          afterState: after,
          requestId: '00000000-0000-4000-8000-0000000000a2',
        });
        await a.study.setCardCadenceState(tx, newCard.id, after, 0);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const events = await sql.select().from(reviewEvents).where(eq(reviewEvents.cardId, newCard.id));
    expect(events).toHaveLength(0);
    const card = await a.cards.get(newCard.id, deck.id);
    expect(card?.version).toBe(0);
  });

  it('undoes only the latest active review and restores exact state', async () => {
    const { a, deck, newCard } = await seededDeckWithCards();
    const now = new Date('2026-09-04T12:00:00.000Z');
    const later = new Date('2026-09-04T12:30:00.000Z');
    const before = newCardState();

    const firstLearning = { ...before, cadencePhase: 'learning' as const, nextReviewAt: '2026-09-04T12:01:00.000Z', intervalDays: 1 / 1440, reviewCount: 1, schedulerVersion: 1 };
    const first = await a.study.transaction(async (tx) => {
      const event = await a.study.insertReviewEvent(tx, { cardId: newCard.id, rating: 'again', reviewedAt: now, beforeState: before, afterState: firstLearning, requestId: '00000000-0000-4000-8000-0000000000a3' });
      await a.study.setCardCadenceState(tx, newCard.id, firstLearning, 0);
      return event;
    });

    // A second, later rating makes the first no longer "latest active".
    const secondReview = { ...firstLearning, cadencePhase: 'review' as const, nextReviewAt: '2026-09-05T12:00:00.000Z', intervalDays: 1, reviewCount: 2, schedulerVersion: 1 };
    const second = await a.study.transaction(async (tx) => {
      const event = await a.study.insertReviewEvent(tx, { cardId: newCard.id, rating: 'good', reviewedAt: later, beforeState: firstLearning, afterState: secondReview, requestId: '00000000-0000-4000-8000-0000000000a4' });
      await a.study.setCardCadenceState(tx, newCard.id, secondReview, 1);
      return event;
    });

    // The first review is no longer the latest active review…
    expect(
      await a.study.transaction(async (tx) => a.study.isLatestActiveReview(tx, newCard.id, new Date(first.reviewedAt), first.id)),
    ).toBe(false);
    // …and the second one is.
    expect(
      await a.study.transaction(async (tx) => a.study.isLatestActiveReview(tx, newCard.id, new Date(second.reviewedAt), second.id)),
    ).toBe(true);

    // Undo the latest (second) review: restore the exact state recorded before it.
    await a.study.transaction(async (tx) => {
      const event = await a.study.lockReviewForUpdate(tx, second.id, deck.id);
      if (!event || event.undoneAt) throw new Error('missing');
      await a.study.markEventUndone(tx, second.id, now);
      await a.study.setCardCadenceState(tx, newCard.id, event.beforeState!, 2);
    });

    const cardAfterUndo = await a.cards.get(newCard.id, deck.id);
    expect(cardAfterUndo?.reviewCount).toBe(1); // the "again" rating state
    expect(cardAfterUndo?.cadencePhase).toBe('learning');
    const events = await a.study.getHistory({ cardId: newCard.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(events.events[0].undoneAt).not.toBeNull();
  });

  it('keeps user B completely out of user A data', async () => {
    const { a, deck, newCard } = await seededDeckWithCards();
    const b = reposFor(userIdB);

    expect(await b.study.deckOwned(deck.id)).toBe(false);
    expect(await b.study.transaction(async (tx) => b.study.lockCardForUpdate(tx, newCard.id, deck.id))).toBeNull();
    const history = await b.study.getHistory({ cardId: newCard.id, deckId: deck.id, pagination: { limit: 10 } });
    expect(history.events).toHaveLength(0);
    const buckets = await b.study.queueBuckets({ deckId: deck.id, now: new Date(), horizonMs: 48 * 3_600_000, limit: 10 });
    expect(buckets.newCards).toHaveLength(0);
    expect(buckets.reviewedCards).toHaveLength(0);
  });
});