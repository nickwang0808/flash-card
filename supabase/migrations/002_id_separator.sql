-- Change card ID separator from '|' to '::'
-- The '|' character and parentheses in card terms break PostgREST's .or() query parser.

-- Temporarily drop FK constraints
ALTER TABLE card_snapshots DROP CONSTRAINT "card_snapshots_cardId_fkey";
ALTER TABLE srs_state DROP CONSTRAINT "srs_state_cardId_fkey";
ALTER TABLE review_logs DROP CONSTRAINT "review_logs_cardId_fkey";

-- Update all IDs
UPDATE cards SET id = replace(id, '|', '::');
UPDATE srs_state SET "cardId" = replace("cardId", '|', '::'), id = replace(id, '|', '::');
UPDATE review_logs SET "cardId" = replace("cardId", '|', '::'), id = replace(id, '|', '::');
UPDATE card_snapshots SET "cardId" = replace("cardId", '|', '::');

-- Recreate FK constraints
ALTER TABLE card_snapshots ADD CONSTRAINT "card_snapshots_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES cards(id) ON DELETE CASCADE;
ALTER TABLE srs_state ADD CONSTRAINT "srs_state_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES cards(id) ON DELETE CASCADE;
ALTER TABLE review_logs ADD CONSTRAINT "review_logs_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES cards(id) ON DELETE CASCADE;
