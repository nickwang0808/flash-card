import { and, arrayContains, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import type { Card, CardContent } from '../../../../src/domain/Card.ts';
import type { CardRevision } from '../../../../src/domain/CardRevision.ts';
import { ApplicationError } from '../../../../src/domain/errors.ts';
import type { PaginationInput, PageInfo } from '../../../../src/api/pagination.ts';
import type { AppDb, DbTransaction } from '../../../../src/db/client.ts';
import { cardRevisions, cards, decks } from '../../../../src/db/schema.ts';
import type { CardRow } from '../../../../src/db/schema.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { mapCardRevisionRow, mapCardRow } from './mappers.ts';

/** Tenant-scoped card persistence. Every read/write verifies deck ownership. */
export interface CardRepository {
  transaction<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T>;
  get(cardId: string, deckId: string): Promise<Card | null>;
  search(input: { deckId: string | null; query: string; pagination: PaginationInput }): Promise<{ cards: Card[]; pageInfo: PageInfo }>;
  create(input: { deckId: string; content: CardContent; tags: string[] }): Promise<Card>;
  update(input: { cardId: string; deckId: string; expectedVersion: number; content: CardContent; tags: string[] }): Promise<Card>;
  setSuspended(input: { cardId: string; deckId: string; expectedVersion: number; suspended: boolean }): Promise<Card>;
  remove(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<void>;
  revisions(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ revisions: CardRevision[]; pageInfo: PageInfo }>;
  rollbackRevision(input: { cardId: string; deckId: string; revisionId: string; expectedVersion: number }): Promise<Card>;
}

/** Owner-scoped card select: joins through the user's deck so unowned rows never match. */
function ownedCardSelect(db: AppDb, userId: string) {
  return db.select().from(cards).innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)));
}

function unwrapCard(rows: { cards: CardRow; decks: { id: string } }[]): CardRow | null {
  return rows.length === 0 ? null : rows[0].cards;
}

/** Keyset predicate for (createdAt desc, id desc) ordering: rows strictly before the cursor. */
function createdBeforeCursor(
  createdAt: typeof cards.createdAt | typeof cardRevisions.createdAt,
  id: typeof cards.id | typeof cardRevisions.id,
  after: { timestamp: string; id: string },
) {
  const timestamp = new Date(after.timestamp);
  return or(lt(createdAt, timestamp), and(eq(createdAt, timestamp), lt(id, after.id)));
}

export class PostgresCardRepository implements CardRepository {
  constructor(
    private readonly db: AppDb,
    private readonly userId: string,
  ) {}

  transaction<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async get(cardId: string, deckId: string): Promise<Card | null> {
    const rows = await ownedCardSelect(this.db, this.userId)
      .where(and(eq(cards.id, cardId), eq(cards.deckId, deckId)))
      .limit(1);
    const row = unwrapCard(rows);
    return row ? mapCardRow(row) : null;
  }

  async search(input: { deckId: string | null; query: string; pagination: PaginationInput }): Promise<{ cards: Card[]; pageInfo: PageInfo }> {
    const limit = input.pagination.limit + 1;
    const needle = `%${input.query.toLowerCase()}%`;
    const after = input.pagination.cursor ? decodeCursor(input.pagination.cursor) : null;
    const conditions: (SQL | undefined)[] = [
      or(
        ilike(cards.name, needle),
        ilike(cards.frontMarkdown, needle),
        ilike(cards.backMarkdown, needle),
        arrayContains(cards.tags, [input.query]),
      ),
    ];
    if (input.deckId !== null) {
      conditions.push(eq(cards.deckId, input.deckId));
    }
    if (after) {
      conditions.push(createdBeforeCursor(cards.createdAt, cards.id, after));
    }

    const rows = await ownedCardSelect(this.db, this.userId)
      .where(and(...conditions))
      .orderBy(desc(cards.createdAt), desc(cards.id))
      .limit(limit);

    const items = rows.map((row) => mapCardRow(row.cards));
    const hasMore = items.length > input.pagination.limit;
    const pageItems = hasMore ? items.slice(0, input.pagination.limit) : items;
    return {
      cards: pageItems,
      pageInfo: { nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1].createdAt, pageItems[pageItems.length - 1].id) : null },
    };
  }

  async create(input: { deckId: string; content: CardContent; tags: string[] }): Promise<Card> {
    return this.transaction(async (tx) => {
      const owned = await tx
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.id, input.deckId), eq(decks.userId, this.userId)))
        .limit(1);
      if (owned.length === 0) {
        throw new ApplicationError('NOT_FOUND', 'Deck not found');
      }

      const rows = await tx
        .insert(cards)
        .values({
          deckId: input.deckId,
          name: input.content.name,
          frontMarkdown: input.content.frontMarkdown,
          backMarkdown: input.content.backMarkdown,
          speechText: input.content.speechText,
          speechLocale: input.content.speechLocale,
          tags: input.tags,
        })
        .returning();
      const card = mapCardRow(rows[0]);
      await this.recordRevision(tx, card.id, 'created', null, input.content);
      return card;
    });
  }

  async update(input: { cardId: string; deckId: string; expectedVersion: number; content: CardContent; tags: string[] }): Promise<Card> {
    return this.transaction(async (tx) => {
      const before = await this.lockContentForUpdate(tx, input.cardId, input.deckId, input.expectedVersion);
      const rows = await tx
        .update(cards)
        .set({
          name: input.content.name,
          frontMarkdown: input.content.frontMarkdown,
          backMarkdown: input.content.backMarkdown,
          speechText: input.content.speechText,
          speechLocale: input.content.speechLocale,
          tags: input.tags,
          version: input.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .from(decks)
        .where(and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId), eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion)))
        .returning();
      if (rows.length === 0) {
        throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
      }
      const card = mapCardRow(rows[0]);
      await this.recordRevision(tx, card.id, 'edited', cardContentOf(before), input.content);
      return card;
    });
  }

  async setSuspended(input: { cardId: string; deckId: string; expectedVersion: number; suspended: boolean }): Promise<Card> {
    const rows = await this.db
      .update(cards)
      .set({ suspended: input.suspended, version: input.expectedVersion + 1, updatedAt: new Date() })
      .from(decks)
      .where(and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId), eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion)))
      .returning();
    if (rows.length === 0) {
      throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
    }
    return mapCardRow(rows[0]);
  }

  async remove(input: { cardId: string; deckId: string; expectedVersion: number }): Promise<void> {
    return this.transaction(async (tx) => {
      const owned = await tx
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.id, input.deckId), eq(decks.userId, this.userId)))
        .limit(1);
      if (owned.length === 0) {
        throw new ApplicationError('NOT_FOUND', 'Card not found');
      }
      const rows = await tx
        .delete(cards)
        .where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion)))
        .returning({ id: cards.id });
      if (rows.length === 0) {
        throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
      }
    });
    return this.transaction(async (tx) => {
      const owned = await tx
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.id, input.deckId), eq(decks.userId, this.userId)))
        .limit(1);
      if (owned.length === 0) {
        throw new ApplicationError('NOT_FOUND', 'Card not found');
      }
      const rows = await tx
        .delete(cards)
        .where(and(eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion)))
        .returning({ id: cards.id });
      if (rows.length === 0) {
        throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
      }
    });
  }

  async revisions(input: { cardId: string; deckId: string; pagination: PaginationInput }): Promise<{ revisions: CardRevision[]; pageInfo: PageInfo }> {
    const limit = input.pagination.limit + 1;
    const after = input.pagination.cursor ? decodeCursor(input.pagination.cursor) : null;
    const conditions: (SQL | undefined)[] = [eq(cardRevisions.cardId, input.cardId), eq(cards.deckId, input.deckId)];
    if (after) {
      conditions.push(createdBeforeCursor(cardRevisions.createdAt, cardRevisions.id, after));
    }

    const rows = await this.db
      .select({ revision: cardRevisions })
      .from(cardRevisions)
      .innerJoin(cards, eq(cards.id, cardRevisions.cardId))
      .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId)))
      .where(and(...conditions))
      .orderBy(desc(cardRevisions.createdAt), desc(cardRevisions.id))
      .limit(limit);

    const items = rows.map((row) => mapCardRevisionRow(row.revision));
    const hasMore = items.length > input.pagination.limit;
    const pageItems = hasMore ? items.slice(0, input.pagination.limit) : items;
    return {
      revisions: pageItems,
      pageInfo: { nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1].createdAt, pageItems[pageItems.length - 1].id) : null },
    };
  }

  async rollbackRevision(input: { cardId: string; deckId: string; revisionId: string; expectedVersion: number }): Promise<Card> {
    return this.transaction(async (tx) => {
      const revisionRows = await tx
        .select({ revision: cardRevisions })
        .from(cardRevisions)
        .innerJoin(cards, eq(cards.id, cardRevisions.cardId))
        .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId)))
        .where(and(eq(cardRevisions.id, input.revisionId), eq(cardRevisions.cardId, input.cardId), eq(cards.deckId, input.deckId)))
        .limit(1);
      if (revisionRows.length === 0) {
        throw new ApplicationError('NOT_FOUND', 'Revision not found');
      }
      const revision = revisionRows[0].revision;

      const rows = await tx
        .update(cards)
        .set({
          name: revision.afterContent.name,
          frontMarkdown: revision.afterContent.frontMarkdown,
          backMarkdown: revision.afterContent.backMarkdown,
          speechText: revision.afterContent.speechText,
          speechLocale: revision.afterContent.speechLocale,
          version: input.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .from(decks)
        .where(and(eq(decks.id, cards.deckId), eq(decks.userId, this.userId), eq(cards.id, input.cardId), eq(cards.deckId, input.deckId), eq(cards.version, input.expectedVersion)))
        .returning();
      if (rows.length === 0) {
        throw await this.versionOrMissingError(input.cardId, input.deckId, input.expectedVersion);
      }
      const card = mapCardRow(rows[0]);
      await this.recordRevision(tx, card.id, 'restored', cardContentOf(card), revision.afterContent);
      return card;
    });
  }

  /** Locks the owned card row and returns its current content, or rejects on a stale version. */
  private async lockContentForUpdate(tx: DbTransaction, cardId: string, deckId: string, expectedVersion: number): Promise<Card> {
    const rows = await ownedCardSelect(tx, this.userId)
      .where(and(eq(cards.id, cardId), eq(cards.deckId, deckId)))
      .limit(1)
      .for('update', { of: cards });
    const row = unwrapCard(rows);
    if (!row) {
      throw new ApplicationError('NOT_FOUND', 'Card not found');
    }
    const card = mapCardRow(row);
    if (card.version !== expectedVersion) {
      throw new ApplicationError('CONFLICT', `Card changed since version ${expectedVersion}`);
    }
    return card;
  }

  private async recordRevision(
    tx: DbTransaction,
    cardId: string,
    eventType: 'created' | 'edited' | 'restored' | 'ai_generated',
    beforeContent: CardContent | null,
    afterContent: CardContent,
  ): Promise<void> {
    await tx.insert(cardRevisions).values({
      cardId,
      eventType,
      beforeContent,
      afterContent,
    });
  }

  /** Resolve a failed guarded write into NOT_FOUND vs CONFLICT without leaking. */
  private async versionOrMissingError(cardId: string, deckId: string, expectedVersion: number): Promise<ApplicationError> {
    const card = await this.get(cardId, deckId);
    if (!card) {
      return new ApplicationError('NOT_FOUND', 'Card not found');
    }
    return new ApplicationError('CONFLICT', `Card changed since version ${expectedVersion}`);
  }
}

function cardContentOf(card: Card): CardContent {
  return {
    name: card.name,
    frontMarkdown: card.frontMarkdown,
    backMarkdown: card.backMarkdown,
    speechText: card.speechText,
    speechLocale: card.speechLocale,
  };
}
