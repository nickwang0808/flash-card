ALTER TABLE "review_events" DROP CONSTRAINT "review_events_rating_check";--> statement-breakpoint
DROP INDEX "review_events_cadence_reviewed_idx";--> statement-breakpoint
ALTER TABLE "review_events" ALTER COLUMN "rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "import_request_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "import_payload_hash" text;--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "origin" text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "recalled" boolean;--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "sequence" integer;--> statement-breakpoint
UPDATE "review_events" SET "recalled" = "rating" <> 'again';--> statement-breakpoint
WITH "ranked_review_events" AS (
  SELECT "id", row_number() OVER (PARTITION BY "cadence_id" ORDER BY "reviewed_at", "id")::integer AS "sequence"
  FROM "review_events"
)
UPDATE "review_events"
SET "sequence" = "ranked_review_events"."sequence"
FROM "ranked_review_events"
WHERE "review_events"."id" = "ranked_review_events"."id";--> statement-breakpoint
ALTER TABLE "review_events" ALTER COLUMN "sequence" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "review_events_cadence_sequence_idx" ON "review_events" USING btree ("cadence_id","sequence" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_import_request_id_key" UNIQUE("import_request_id");--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_cadence_id_sequence_key" UNIQUE("cadence_id","sequence");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_import_fields_all_or_none" CHECK (("cards"."import_request_id" is null and "cards"."import_payload_hash" is null) or ("cards"."import_request_id" is not null and "cards"."import_payload_hash" is not null));--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_origin_check" CHECK ("review_events"."origin" in ('native', 'imported'));--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_result_check" CHECK (("review_events"."origin" = 'native' and "review_events"."rating" is not null) or ("review_events"."origin" = 'imported' and ("review_events"."rating" is not null or "review_events"."recalled" is not null)));--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_duration_ms_check" CHECK ("review_events"."duration_ms" is null or "review_events"."duration_ms" >= 0);--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_sequence_check" CHECK ("review_events"."sequence" > 0);--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_rating_check" CHECK ("review_events"."rating" is null or "review_events"."rating" in ('again', 'hard', 'good', 'easy'));