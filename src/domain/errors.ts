export const applicationErrorCodes = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_STATE',
  'INTERNAL',
] as const;

export type ApplicationErrorCode = (typeof applicationErrorCodes)[number];

export const trpcCodeByApplicationError: Readonly<Record<ApplicationErrorCode, string>> = {
  UNAUTHENTICATED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'BAD_REQUEST',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_CONFLICT: 'CONFLICT',
  INVALID_STATE: 'BAD_REQUEST',
  INTERNAL: 'INTERNAL_SERVER_ERROR',
};

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>> | undefined;

  constructor(
    code: ApplicationErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.details = details;
  }
}

export function toTRPCErrorCode(code: ApplicationErrorCode): string {
  return trpcCodeByApplicationError[code];
}
