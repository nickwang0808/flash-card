import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { CardCadence } from '../../../../../src/domain/Cadence.ts';
import type { Card } from '../../../../../src/domain/Card.ts';
import { cardCadences, cards } from '../../../../../src/db/schema.ts';
import { fixtureDb } from './database.ts';
import type { TestActor } from './actor.ts';

export async function createDeck(actor: TestActor, name = `Deck ${randomUUID()}`) {
  return actor.api.deck.create({ name, defaultSpeechLocale: null });
}

export async function createNewCard(
  actor: TestActor,
  deck: { id: string },
  overrides: Partial<Pick<Card, 'name' | 'frontMarkdown' | 'backMarkdown' | 'tags' | 'reversible'>> = {},
) {
  return actor.api.card.create({
    deckId: deck.id,
    name: overrides.name ?? `Card ${randomUUID()}`,
    frontMarkdown: overrides.frontMarkdown ?? 'Front',
    backMarkdown: overrides.backMarkdown ?? 'Back',
    tags: overrides.tags ?? [],
    speechText: null,
    speechLocale: null,
    reversible: overrides.reversible ?? false,
  });
}

export async function createStudiedCard(
  actor: TestActor,
  deck: { id: string },
  overrides: Partial<Pick<Card, 'name' | 'frontMarkdown' | 'backMarkdown' | 'tags' | 'suspended' | 'createdAt' | 'updatedAt'>> & Partial<Pick<CardCadence, 'nextReviewAt' | 'intervalDays' | 'reviewCount' | 'lapseCount' | 'version'>> = {},
) {
  const card = await createNewCard(actor, deck, overrides);
  const cadence = card.cadences[0];
  const timestamp = actor.clock.iso();
  await fixtureDb().transaction(async (tx) => {
    await tx.update(cards).set({
      suspended: overrides.suspended ?? false,
      createdAt: overrides.createdAt ?? timestamp,
      updatedAt: overrides.updatedAt ?? timestamp,
    }).where(eq(cards.id, card.id));
    await tx.update(cardCadences).set({
      nextReviewAt: overrides.nextReviewAt ?? new Date(actor.clock.now().getTime() + 3_600_000).toISOString(),
      intervalDays: overrides.intervalDays ?? 1,
      reviewCount: overrides.reviewCount ?? 1,
      lapseCount: overrides.lapseCount ?? 0,
      version: overrides.version ?? 1,
      createdAt: overrides.createdAt ?? timestamp,
      updatedAt: overrides.updatedAt ?? timestamp,
    }).where(eq(cardCadences.id, cadence.id));
  });
  return actor.api.card.get({ cardId: card.id, deckId: deck.id });
}
