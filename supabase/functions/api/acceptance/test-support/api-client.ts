import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../router.ts';
import { TestClock } from './clock.ts';
import { acceptanceEnv, functionUrl } from './environment.ts';

type Inputs = inferRouterInputs<AppRouter>;
type Outputs = inferRouterOutputs<AppRouter>;

export class AcceptanceApiClient {
  constructor(readonly accessToken: string, readonly clock: TestClock) {}

  async query<T>(path: string, input: unknown): Promise<T> {
    const response = await fetch(`${functionUrl}/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: this.headers() });
    return this.result<T>(path, response);
  }

  async mutation<T>(path: string, input: unknown): Promise<T> {
    const response = await fetch(`${functionUrl}/${path}`, { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return this.result<T>(path, response);
  }

  deck = {
    create: (input: Inputs['deck']['create']) => this.mutation<Outputs['deck']['create']>('deck.create', input),
    list: () => this.query<Outputs['deck']['list']>('deck.list', {}),
    rename: (input: Inputs['deck']['rename']) => this.mutation<Outputs['deck']['rename']>('deck.rename', input),
    remove: (input: Inputs['deck']['remove']) => this.mutation<Outputs['deck']['remove']>('deck.remove', input),
    queue: (input: Inputs['deck']['queue']) => this.query<Outputs['deck']['queue']>('deck.queue', input),
  };

  card = {
    create: (input: Inputs['card']['create']) => this.mutation<Outputs['card']['create']>('card.create', input),
    get: (input: Inputs['card']['get']) => this.query<Outputs['card']['get']>('card.get', input),
    search: (input: Inputs['card']['search']) => this.query<Outputs['card']['search']>('card.search', input),
    update: (input: Inputs['card']['update']) => this.mutation<Outputs['card']['update']>('card.update', input),
    suspend: (input: Inputs['card']['suspend']) => this.mutation<Outputs['card']['suspend']>('card.suspend', input),
    restore: (input: Inputs['card']['restore']) => this.mutation<Outputs['card']['restore']>('card.restore', input),
    remove: (input: Inputs['card']['remove']) => this.mutation<Outputs['card']['remove']>('card.remove', input),
    revisions: (input: Inputs['card']['revisions']) => this.query<Outputs['card']['revisions']>('card.revisions', input),
    rollbackRevision: (input: Inputs['card']['rollbackRevision']) => this.mutation<Outputs['card']['rollbackRevision']>('card.rollbackRevision', input),
  };

  review = {
    rate: (input: Inputs['review']['rate']) => this.mutation<Outputs['review']['rate']>('review.rate', input),
    undo: (input: Inputs['review']['undo']) => this.mutation<Outputs['review']['undo']>('review.undo', input),
    history: (input: Inputs['review']['history']) => this.query<Outputs['review']['history']>('review.history', input),
  };

  auth = { session: () => this.query<Outputs['auth']['session']>('auth.session', {}) };

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'X-Flashcard-Test-Clock': this.clock.iso(),
      'X-Flashcard-Test-Secret': acceptanceEnv.clockSecret,
    };
  }

  private async result<T>(path: string, response: Response): Promise<T> {
    const body = await response.json() as { result?: { data?: T }; error?: { message?: string; data?: { code?: string; applicationCode?: string } } };
    if (!response.ok || body.error) throw new AcceptanceApiError(path, response.status, body.error);
    if (body.result?.data === undefined) throw new Error(`${path} returned no tRPC result`);
    return body.result.data;
  }
}

class AcceptanceApiError extends Error {
  constructor(readonly path: string, readonly status: number, readonly error: unknown) {
    super(`${path} HTTP ${status}: ${JSON.stringify(error)}`);
  }
}
