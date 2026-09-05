-- Revert partial unique index back to a full unique constraint.
-- Partial indexes cannot be used as ON CONFLICT targets in PostgreSQL.
-- Soft-deleted row conflicts are handled by the push handler using
-- ON CONFLICT ("cardId", direction) which overwrites the deleted row.

DROP INDEX IF EXISTS "srs_state_cardId_direction_key";

ALTER TABLE srs_state
  ADD CONSTRAINT "srs_state_cardId_direction_key"
  UNIQUE ("cardId", direction);
