-- Change tags from text[] to text (JSON string) for RxDB replication compatibility
ALTER TABLE cards ALTER COLUMN tags TYPE text USING array_to_json(tags)::text;
ALTER TABLE cards ALTER COLUMN tags SET DEFAULT '[]';

-- Add _deleted to tables that didn't have it (for RxDB soft-delete replication)
ALTER TABLE srs_state ADD COLUMN IF NOT EXISTS _deleted boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS _deleted boolean NOT NULL DEFAULT false;

-- Auto-update _modified on all synced tables
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW._modified = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cards_modified BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_srs_state_modified BEFORE UPDATE ON srs_state FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_review_logs_modified BEFORE UPDATE ON review_logs FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_settings_modified BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Enable Realtime for live pull streams
ALTER PUBLICATION supabase_realtime ADD TABLE cards, srs_state, review_logs, settings;
