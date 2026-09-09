import { describe, expect, it } from 'vitest';
import { corsHeaders, withCors } from './cors.ts';

const origin = 'https://nickwang0808.github.io';

describe('API CORS responses', () => {
  it('preserves a successful response while allowing the configured web origin', async () => {
    const request = new Request('https://project.supabase.co/functions/v1/api/deck.list', { headers: { Origin: origin } });
    const response = withCors(new Response(JSON.stringify({ result: { data: { decks: [] } } }), { headers: { 'Content-Type': 'application/json' } }), request, [origin]);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('vary')).toBe('Origin');
    await expect(response.json()).resolves.toEqual({ result: { data: { decks: [] } } });
  });

  it('rejects an unconfigured origin', () => {
    const request = new Request('https://project.supabase.co/functions/v1/api/deck.list', { headers: { Origin: 'https://untrusted.example' } });

    expect(corsHeaders(request, [origin])['Access-Control-Allow-Origin']).toBe('null');
  });
});
