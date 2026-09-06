import { and, eq } from 'drizzle-orm';
import type { AppDb } from './client.ts';
import { cardCadences, cardRevisions, cards, decks, reviewEvents } from './schema.ts';
import { ApplicationError } from '../domain/errors.ts';

export function decksOwnedBy(db: AppDb, userId: string) {
  return db.select().from(decks).where(eq(decks.userId, userId));
}

export function cardsOwnedBy(db: AppDb, userId: string) {
  return db.select().from(cards).innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)));
}

export function cardCadencesOwnedBy(db: AppDb, userId: string) {
  return db
    .select({ card: cards, cadence: cardCadences })
    .from(cardCadences)
    .innerJoin(cards, eq(cards.id, cardCadences.cardId))
    .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)));
}

export function reviewEventsOf(db: AppDb, userId: string) {
  return db
    .select({ event: reviewEvents, cadence: cardCadences, card: cards })
    .from(reviewEvents)
    .innerJoin(cardCadences, eq(cardCadences.id, reviewEvents.cadenceId))
    .innerJoin(cards, eq(cards.id, cardCadences.cardId))
    .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)));
}

export function deckRevisionsOf(db: AppDb, userId: string) {
  return db
    .select({ revision: cardRevisions })
    .from(cardRevisions)
    .innerJoin(cards, eq(cards.id, cardRevisions.cardId))
    .innerJoin(decks, and(eq(decks.id, cards.deckId), eq(decks.userId, userId)));
}

export async function requireDeck(db: AppDb, userId: string, deckId: string) {
  const rows = await db.select().from(decks).where(and(eq(decks.id, deckId), eq(decks.userId, userId))).limit(1);
  if (rows.length === 0) throw new ApplicationError('NOT_FOUND', 'Deck not found');
  return rows[0];
}


export async function requireDeckForCard(db: AppDb, userId: string, cardId: string, deckId: string) {
  const rows = await cardsOwnedBy(db, userId).where(and(eq(cards.id, cardId), eq(cards.deckId, deckId))).limit(1);
  if (rows.length === 0) throw new ApplicationError('NOT_FOUND', 'Card not found');
  return rows[0].cards;
}

export function encodeCursor(isoTimestamp: string, id: string): string {
  return btoa(`${isoTimestamp}|${id}`);
}

export function decodeCursor(cursor: string): { timestamp: string; id: string } {
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    throw new ApplicationError('VALIDATION_FAILED', 'Invalid pagination cursor');
  }
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0 || separator === decoded.length - 1) {
    throw new ApplicationError('VALIDATION_FAILED', 'Invalid pagination cursor');
  }
  return { timestamp: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}
