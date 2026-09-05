-- Canonical baseline for databases created by the acceptance runner.
-- Auth is owned by Supabase; this migration creates only application tables.
CREATE TABLE IF NOT EXISTS "decks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "default_speech_locale" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "decks_user_id_name_key" UNIQUE("user_id", "name"),
  CONSTRAINT "decks_version_check" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "deck_id" uuid NOT NULL REFERENCES "decks"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "front_markdown" text NOT NULL,
  "back_markdown" text NOT NULL,
  "speech_text" text,
  "speech_locale" text,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "suspended" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "cadence_phase" text,
  "next_review_at" timestamptz,
  "interval_days" double precision,
  "review_count" integer DEFAULT 0 NOT NULL,
  "lapse_count" integer DEFAULT 0 NOT NULL,
  "scheduler_version" integer,
  "version" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "cards_name_check" CHECK (btrim("name") <> ''),
  CONSTRAINT "cards_cadence_phase_check" CHECK ("cadence_phase" IN ('learning', 'review')),
  CONSTRAINT "cards_interval_days_check" CHECK ("interval_days" IS NULL OR "interval_days" > 0),
  CONSTRAINT "cards_review_count_check" CHECK ("review_count" >= 0),
  CONSTRAINT "cards_lapse_count_check" CHECK ("lapse_count" >= 0),
  CONSTRAINT "cards_scheduler_version_check" CHECK ("scheduler_version" IS NULL OR "scheduler_version" > 0),
  CONSTRAINT "cards_version_check" CHECK ("version" >= 0),
  CONSTRAINT "cadence_fields_all_or_none" CHECK (("cadence_phase" IS NULL AND "next_review_at" IS NULL AND "interval_days" IS NULL AND "scheduler_version" IS NULL) OR ("cadence_phase" IS NOT NULL AND "next_review_at" IS NOT NULL AND "interval_days" IS NOT NULL AND "scheduler_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "rating" text NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "before_state" jsonb,
  "after_state" jsonb NOT NULL,
  "request_id" uuid NOT NULL,
  "undone_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "review_events_card_id_request_id_key" UNIQUE("card_id", "request_id"),
  CONSTRAINT "review_events_rating_check" CHECK ("rating" IN ('again', 'hard', 'good', 'easy'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "before_content" jsonb,
  "after_content" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "card_revisions_event_type_check" CHECK ("event_type" IN ('created', 'edited', 'restored', 'ai_generated'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decks_user_id_idx" ON "decks" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_deck_id_idx" ON "cards" USING btree ("deck_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_new_order_idx" ON "cards" USING btree ("deck_id", "created_at", "id") WHERE "next_review_at" IS NULL AND NOT "suspended";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_review_order_idx" ON "cards" USING btree ("deck_id", "next_review_at", "id") WHERE "next_review_at" IS NOT NULL AND NOT "suspended";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_events_card_reviewed_idx" ON "review_events" USING btree ("card_id", "reviewed_at" DESC, "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_revisions_card_created_idx" ON "card_revisions" USING btree ("card_id", "created_at" DESC, "id");
--> statement-breakpoint
ALTER TABLE "decks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_revisions" ENABLE ROW LEVEL SECURITY;
