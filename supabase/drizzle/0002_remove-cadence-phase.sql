ALTER TABLE "cards" DROP CONSTRAINT "cards_cadence_phase_check";--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cadence_fields_all_or_none";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "cadence_phase";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "scheduling_fields_all_or_none" CHECK (("cards"."next_review_at" is null and "cards"."interval_days" is null and "cards"."scheduler_version" is null) or ("cards"."next_review_at" is not null and "cards"."interval_days" is not null and "cards"."scheduler_version" is not null));