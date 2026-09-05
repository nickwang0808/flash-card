import { ApplicationError } from '../../../../src/domain/errors.ts';

/**
 * Opaque keyset cursors: base64 of `"<sort timestamp ISO>|<id>"`. The payload
 * is ASCII-only, so the Web `btoa`/`atob` pair is safe on Node and Deno.
 */
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
  if (separator <= 0) {
    throw new ApplicationError('VALIDATION_FAILED', 'Invalid pagination cursor');
  }
  return { timestamp: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}