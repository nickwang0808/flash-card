UPDATE "review_events" SET "before_state" = "before_state" - 'schedulerVersion' - 'scheduler_version', "after_state" = "after_state" - 'schedulerVersion' - 'scheduler_version';--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_scheduler_version_check";--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "scheduling_fields_all_or_none";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "scheduler_version";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "scheduling_fields_all_or_none" CHECK (("cards"."next_review_at" is null and "cards"."interval_days" is null) or ("cards"."next_review_at" is not null and "cards"."interval_days" is not null));