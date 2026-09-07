ALTER TABLE "cards" ADD COLUMN "speech_side" text;
--> statement-breakpoint
UPDATE "cards"
SET "speech_locale" = NULL, "speech_side" = NULL
WHERE "speech_text" IS NULL;
--> statement-breakpoint
UPDATE "cards"
SET "speech_side" = 'front'
WHERE "speech_text" IS NOT NULL;
--> statement-breakpoint
UPDATE "card_revisions"
SET
  "before_content" = CASE
    WHEN "before_content" IS NULL THEN NULL
    WHEN "before_content"->>'speechText' IS NULL THEN ("before_content" - 'speechLocale') || '{"speechLocale": null, "speechSide": null}'::jsonb
    ELSE "before_content" || '{"speechSide": "front"}'::jsonb
  END,
  "after_content" = CASE
    WHEN "after_content"->>'speechText' IS NULL THEN ("after_content" - 'speechLocale') || '{"speechLocale": null, "speechSide": null}'::jsonb
    ELSE "after_content" || '{"speechSide": "front"}'::jsonb
  END;
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_speech_fields_check" CHECK (("cards"."speech_text" is null and "cards"."speech_locale" is null and "cards"."speech_side" is null) or ("cards"."speech_text" is not null and btrim("cards"."speech_text") <> '' and "cards"."speech_side" in ('front', 'back')));