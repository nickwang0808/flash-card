CREATE TABLE "card_cadences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "next_review_at" timestamptz,
  "interval_days" double precision,
  "review_count" integer DEFAULT 0 NOT NULL,
  "lapse_count" integer DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "card_cadences_card_id_direction_key" UNIQUE("card_id", "direction"),
  CONSTRAINT "card_cadences_direction_check" CHECK ("direction" IN ('forward', 'reverse')),
  CONSTRAINT "card_cadences_interval_days_check" CHECK ("interval_days" IS NULL OR "interval_days" > 0),
  CONSTRAINT "card_cadences_review_count_check" CHECK ("review_count" >= 0),
  CONSTRAINT "card_cadences_lapse_count_check" CHECK ("lapse_count" >= 0),
  CONSTRAINT "card_cadences_scheduling_fields_all_or_none" CHECK (("next_review_at" IS NULL AND "interval_days" IS NULL) OR ("next_review_at" IS NOT NULL AND "interval_days" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reversible" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO "card_cadences" ("card_id", "direction", "next_review_at", "interval_days", "review_count", "lapse_count", "version", "created_at", "updated_at")
SELECT "id", 'forward', "next_review_at", "interval_days", "review_count", "lapse_count", "version", "created_at", "updated_at"
FROM "cards";
--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "cadence_id" uuid;
--> statement-breakpoint
UPDATE "review_events" AS event
SET "cadence_id" = cadence."id"
FROM "card_cadences" AS cadence
WHERE cadence."card_id" = event."card_id" AND cadence."direction" = 'forward';
--> statement-breakpoint
ALTER TABLE "review_events" ALTER COLUMN "cadence_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "review_events" DROP CONSTRAINT "review_events_card_id_request_id_key";
--> statement-breakpoint
ALTER TABLE "review_events" DROP CONSTRAINT "review_events_card_id_cards_id_fk";
--> statement-breakpoint
ALTER TABLE "review_events" DROP COLUMN "card_id";
--> statement-breakpoint
DROP INDEX "cards_new_order_idx";
--> statement-breakpoint
DROP INDEX "cards_review_order_idx";
--> statement-breakpoint
DROP INDEX "review_events_card_reviewed_idx";
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_interval_days_check";
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_review_count_check";
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_lapse_count_check";
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "scheduling_fields_all_or_none";
--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "next_review_at", DROP COLUMN "interval_days", DROP COLUMN "review_count", DROP COLUMN "lapse_count";
--> statement-breakpoint
CREATE INDEX "card_cadences_new_order_idx" ON "card_cadences" USING btree ("card_id", "direction", "id") WHERE "next_review_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "card_cadences_review_order_idx" ON "card_cadences" USING btree ("next_review_at", "id") WHERE "next_review_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_cadence_id_card_cadences_id_fk" FOREIGN KEY ("cadence_id") REFERENCES "public"."card_cadences"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "review_events_cadence_id_request_id_key" ON "review_events" USING btree ("cadence_id", "request_id");
--> statement-breakpoint
CREATE INDEX "review_events_cadence_reviewed_idx" ON "review_events" USING btree ("cadence_id", "reviewed_at" DESC, "id");
--> statement-breakpoint
ALTER TABLE "card_cadences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "review_events select own" ON "review_events";
--> statement-breakpoint
DROP POLICY IF EXISTS "review_events insert own" ON "review_events";
--> statement-breakpoint
DROP POLICY IF EXISTS "review_events update own" ON "review_events";
--> statement-breakpoint
DROP POLICY IF EXISTS "review_events delete own" ON "review_events";
--> statement-breakpoint
CREATE POLICY "review_events select own" ON "review_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));
--> statement-breakpoint
CREATE POLICY "review_events insert own" ON "review_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));
--> statement-breakpoint
CREATE POLICY "review_events update own" ON "review_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));
--> statement-breakpoint
CREATE POLICY "review_events delete own" ON "review_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));
--> statement-breakpoint
CREATE POLICY "card_cadences select own" ON "card_cadences" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));
--> statement-breakpoint
CREATE POLICY "card_cadences insert own" ON "card_cadences" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));
--> statement-breakpoint
CREATE POLICY "card_cadences update own" ON "card_cadences" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));
--> statement-breakpoint
CREATE POLICY "card_cadences delete own" ON "card_cadences" AS PERMISSIVE FOR DELETE TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));