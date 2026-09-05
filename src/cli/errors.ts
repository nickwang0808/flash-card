type CliErrorCode =
  | 'USAGE_ERROR'
  | 'VALIDATION_FAILED'
  | 'CONFIRMATION_REQUIRED'
  | 'CANCELLED'
  | 'CONFIGURATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'AUTHENTICATION_FAILED'
  | 'CREDENTIAL_STORE_UNAVAILABLE'
  | 'CREDENTIAL_STORE_ERROR'
  | 'TRANSPORT_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'INTERNAL';

export class CliError extends Error {
  constructor(readonly code: CliErrorCode, message: string, readonly details?: Record<string, string | number | boolean>) {
    super(message);
    this.name = 'CliError';
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error && /^FLASHCARD_(?:SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|API_URL) /.test(error.message)) return new CliError('CONFIGURATION_ERROR', 'CLI environment is incomplete or invalid');
  if (error instanceof Error && /unknown (?:option|command)|missing required option|too many arguments/i.test(error.message)) return new CliError('USAGE_ERROR', 'Invalid command usage');
  const candidate = error as { data?: { code?: string; applicationCode?: string; details?: unknown }; shape?: { data?: { code?: string; applicationCode?: string } }; code?: string } | null;
  const appCode = candidate?.data?.applicationCode ?? candidate?.shape?.data?.applicationCode;
  if (isKnownCode(appCode)) return new CliError(appCode, 'Request failed');
  const trpcCode = candidate?.data?.code ?? candidate?.shape?.data?.code ?? candidate?.code;
  const mapped: Record<string, CliErrorCode> = {
    UNAUTHORIZED: 'UNAUTHENTICATED', FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT', BAD_REQUEST: 'VALIDATION_FAILED', INTERNAL_SERVER_ERROR: 'INTERNAL',
  };
  if (trpcCode && mapped[trpcCode]) return new CliError(mapped[trpcCode], 'Request failed');
  if (error instanceof TypeError && /fetch|network|connect/i.test(error.message)) return new CliError('TRANSPORT_ERROR', 'Network request failed');
  return new CliError('INTERNAL', 'Unexpected CLI failure');
}

function isKnownCode(value: unknown): value is CliErrorCode {
  return typeof value === 'string' && [
    'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVALID_STATE', 'INTERNAL',
  ].includes(value);
}
