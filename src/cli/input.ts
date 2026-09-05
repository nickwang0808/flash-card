import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CardContentSchema } from '../domain/Card.ts';
import { RatingSchema, UuidSchema } from '../domain/primitives.ts';
import { QueueOptionsSchema } from '../domain/StudyQueue.ts';
import { CliError } from './errors.ts';

const MAX_INPUT_BYTES = 1024 * 1024;
const strictInteger = z.number().int().nonnegative();
const pagination = z.object({ cursor: z.string().min(1).max(500).nullable().optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();
const queue = QueueOptionsSchema.strict();

export const schemas = {
  deckCreate: z.object({ name: z.string().trim().min(1).max(200), defaultSpeechLocale: z.string().trim().max(35).nullable().default(null) }).strict(),
  deckRename: z.object({ deckId: UuidSchema, name: z.string().trim().min(1).max(200), expectedVersion: strictInteger }).strict(),
  deckRemove: z.object({ deckId: UuidSchema, expectedVersion: strictInteger }).strict(),
  deckQueue: z.object({ deckId: UuidSchema, limit: z.number().int().min(1).max(100).optional() }).strict(),
  cardGet: z.object({ cardId: UuidSchema, deckId: UuidSchema }).strict(),
  cardSearch: z.object({ deckId: UuidSchema.nullable().optional(), query: z.string().trim().min(1).max(500), pagination }).strict(),
  cardCreate: CardContentSchema.extend({ deckId: UuidSchema, tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]) }).strict(),
  cardUpdate: CardContentSchema.extend({ cardId: UuidSchema, deckId: UuidSchema, tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]), expectedVersion: strictInteger }).strict(),
  cardQueueMutation: z.object({ cardId: UuidSchema, deckId: UuidSchema, expectedVersion: strictInteger, queue }).strict(),
  cardRemove: z.object({ cardId: UuidSchema, deckId: UuidSchema, expectedVersion: strictInteger, queue }).strict(),
  cardRevisions: z.object({ cardId: UuidSchema, deckId: UuidSchema, pagination }).strict(),
  cardRollback: z.object({ cardId: UuidSchema, deckId: UuidSchema, revisionId: UuidSchema, expectedVersion: strictInteger }).strict(),
  reviewRate: z.object({ cardId: UuidSchema, deckId: UuidSchema, rating: RatingSchema, expectedVersion: strictInteger, requestId: UuidSchema.optional(), queue }).strict(),
  reviewHistory: z.object({ cardId: UuidSchema, deckId: UuidSchema, pagination }).strict(),
  reviewUndo: z.object({ reviewId: UuidSchema, deckId: UuidSchema, queue }).strict(),
};

export async function parseInput<T extends z.ZodType>(source: string, schema: T, stdin: NodeJS.ReadableStream): Promise<z.output<T>> {
  const body = await readBounded(source === '-' ? stdin : undefined, source === '-' ? undefined : source);
  if (body.charCodeAt(0) === 0xFEFF) throw new CliError('VALIDATION_FAILED', 'JSON input must not contain a byte-order mark');
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new CliError('VALIDATION_FAILED', 'Input must be one JSON object'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new CliError('VALIDATION_FAILED', 'Input must be one JSON object');
  return validate(schema, parsed);
}

export function validate<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new CliError('VALIDATION_FAILED', 'Input did not match the command contract');
  return result.data;
}

export function numberFlag(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new CliError('VALIDATION_FAILED', 'Expected a non-negative base-10 integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CliError('VALIDATION_FAILED', 'Expected a safe integer');
  return parsed;
}


async function readBounded(stdin: NodeJS.ReadableStream | undefined, file: string | undefined): Promise<string> {
  if (file) {
    const contents = await readFile(file);
    if (contents.byteLength > MAX_INPUT_BYTES) throw new CliError('VALIDATION_FAILED', 'Input exceeds 1 MiB');
    return contents.toString('utf8');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stdin!) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > MAX_INPUT_BYTES) throw new CliError('VALIDATION_FAILED', 'Input exceeds 1 MiB');
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
