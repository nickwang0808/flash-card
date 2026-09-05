import { randomUUID } from 'node:crypto';
import { CardSchema, type Card } from '../../../../../src/domain/Card.ts';
import { toIsoTimestamp } from '../../../../../src/domain/primitives.ts';
import { cards } from '../../../../../src/db/schema.ts';
import { fixtureDb } from './database.ts';
import type { TestActor } from './actor.ts';

export async function createDeck(actor: TestActor, name = `Deck ${randomUUID()}`) {
  return actor.api.deck.create({ name, defaultSpeechLocale: null });
}

export async function createNewCard(actor: TestActor, deck: { id: string }, overrides: Partial<{ name: string; frontMarkdown: string; backMarkdown: string; tags: string[] }> = {}) {
  return actor.api.card.create({
    deckId: deck.id,
    name: overrides.name ?? `Card ${randomUUID()}`,
    frontMarkdown: overrides.frontMarkdown ?? 'Front',
    backMarkdown: overrides.backMarkdown ?? 'Back',
    tags: overrides.tags ?? [],
    speechText: null,
    speechLocale: null,
  });
}

export async function createStudiedCard(actor: TestActor, deck: { id: string }, overrides: Partial<Pick<Card, 'name' | 'frontMarkdown' | 'backMarkdown' | 'tags' | 'suspended' | 'createdAt' | 'updatedAt' | 'cadencePhase' | 'nextReviewAt' | 'intervalDays' | 'reviewCount' | 'lapseCount' | 'schedulerVersion' | 'version'>> = {}) {
  const timestamp = actor.clock.iso();
  const row = {
    deckId: deck.id,
    name: overrides.name ?? `Studied ${randomUUID()}`,
    frontMarkdown: overrides.frontMarkdown ?? 'Front',
    backMarkdown: overrides.backMarkdown ?? 'Back',
    tags: overrides.tags ?? [],
    speechText: null,
    speechLocale: null,
    suspended: overrides.suspended ?? false,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    cadencePhase: overrides.cadencePhase ?? 'review' as const,
    nextReviewAt: overrides.nextReviewAt ?? new Date(actor.clock.now().getTime() + 3_600_000).toISOString(),
    intervalDays: overrides.intervalDays ?? 1,
    reviewCount: overrides.reviewCount ?? 1,
    lapseCount: overrides.lapseCount ?? 0,
    schedulerVersion: overrides.schedulerVersion ?? 1,
    version: overrides.version ?? 1,
  };
  const [created] = await fixtureDb().insert(cards).values(row).returning();
  return CardSchema.parse({ ...created, createdAt: toIsoTimestamp(created.createdAt), updatedAt: toIsoTimestamp(created.updatedAt), nextReviewAt: created.nextReviewAt ? toIsoTimestamp(created.nextReviewAt) : null });
}
