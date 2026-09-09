export interface VerifiedIdentity {
  userId: string;
  email: string | null;
  clientId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
}