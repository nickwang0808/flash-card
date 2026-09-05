import { afterAll, describe, expect, it } from 'vitest';
import { appRouter } from '../router.ts';
import { createCallerFixture, destroyCallerFixture } from './integration.test-support.ts';

const fixture = await createCallerFixture('auth');
afterAll(async () => { await destroyCallerFixture(fixture); });

describe('auth router caller', () => {
  it('returns the verified identity', async () => {
    await expect(fixture.caller.auth.session({})).resolves.toMatchObject({ userId: fixture.userId });
  });

  it('rejects protected procedures without a user identity', async () => {
    const caller = appRouter.createCaller({ identity: { userId: '', email: null, issuedAt: null, expiresAt: null }, db: fixture.db });
    await expect(caller.deck.list({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
