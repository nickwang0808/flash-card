export function corsHeaders(request: Request, allowedOrigins: readonly string[]): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins.includes('*') || (origin !== null && allowedOrigins.includes(origin)) ? (origin ?? '*') : null;
  return {
    'Access-Control-Allow-Origin': allowed ?? 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Flashcard-Test-Clock, X-Flashcard-Test-Secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function withCors(response: Response, request: Request, allowedOrigins: readonly string[]): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request, allowedOrigins))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
