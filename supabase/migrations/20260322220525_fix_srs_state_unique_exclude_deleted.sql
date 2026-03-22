-- Replace the unique constraint on srs_state with a partial unique index
-- that excludes soft-deleted rows. The old constraint blocks re-creation
-- of srs_state for a cardId+direction after an undo (soft-delete), because
-- the deleted row still holds the unique slot.

ALTER TABLE srs_state DROP CONSTRAINT "srs_state_cardId_direction_key";

CREATE UNIQUE INDEX "srs_state_cardId_direction_key"
  ON srs_state ("cardId", direction)
  WHERE _deleted = false;

-- Clean up any soft-deleted rows — they serve no purpose once the
-- constraint no longer protects them.
DELETE FROM srs_state WHERE _deleted = true;
