-- Pre-production Supabase experiments used an incompatible RxDB-era model.
-- No production data exists, so the baseline removes that model before creating
-- the authoritative schema. The IF EXISTS clauses also make this safe on a
-- completely fresh Supabase project.
DROP TRIGGER IF EXISTS on_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.create_default_settings();
DROP TABLE IF EXISTS public.card_snapshots;
DROP TABLE IF EXISTS public.review_logs;
DROP TABLE IF EXISTS public.srs_state;
DROP TABLE IF EXISTS public.cards;
DROP TABLE IF EXISTS public.settings;
DROP FUNCTION IF EXISTS public.snapshot_card();
DROP FUNCTION IF EXISTS public.update_modified_column();
--> statement-breakpoint
CREATE TABLE "card_cadences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"next_review_at" timestamp with time zone,
	"interval_days" double precision,
	"review_count" integer DEFAULT 0 NOT NULL,
	"lapse_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_cadences_card_id_direction_key" UNIQUE("card_id","direction"),
	CONSTRAINT "card_cadences_direction_check" CHECK ("card_cadences"."direction" in ('forward', 'reverse')),
	CONSTRAINT "card_cadences_interval_days_check" CHECK ("card_cadences"."interval_days" is null or "card_cadences"."interval_days" > 0),
	CONSTRAINT "card_cadences_review_count_check" CHECK ("card_cadences"."review_count" >= 0),
	CONSTRAINT "card_cadences_lapse_count_check" CHECK ("card_cadences"."lapse_count" >= 0),
	CONSTRAINT "card_cadences_scheduling_fields_all_or_none" CHECK (("card_cadences"."next_review_at" is null and "card_cadences"."interval_days" is null) or ("card_cadences"."next_review_at" is not null and "card_cadences"."interval_days" is not null))
);
--> statement-breakpoint
ALTER TABLE "card_cadences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "card_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"before_content" jsonb,
	"after_content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_revisions_event_type_check" CHECK ("card_revisions"."event_type" in ('created', 'edited', 'restored', 'ai_generated'))
);
--> statement-breakpoint
ALTER TABLE "card_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_id" uuid NOT NULL,
	"name" text NOT NULL,
	"front_markdown" text NOT NULL,
	"back_markdown" text NOT NULL,
	"speech_text" text,
	"speech_locale" text,
	"speech_side" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"reversible" boolean DEFAULT false NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"import_request_id" uuid,
	"import_payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cards_import_request_id_key" UNIQUE("import_request_id"),
	CONSTRAINT "cards_import_fields_all_or_none" CHECK (("cards"."import_request_id" is null and "cards"."import_payload_hash" is null) or ("cards"."import_request_id" is not null and "cards"."import_payload_hash" is not null)),
	CONSTRAINT "cards_name_check" CHECK (btrim("cards"."name") <> ''),
	CONSTRAINT "cards_speech_fields_check" CHECK (("cards"."speech_text" is null and "cards"."speech_locale" is null and "cards"."speech_side" is null) or ("cards"."speech_text" is not null and btrim("cards"."speech_text") <> '' and "cards"."speech_side" in ('front', 'back')))
);
--> statement-breakpoint
ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_speech_locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "decks_user_id_name_key" UNIQUE("user_id","name"),
	CONSTRAINT "decks_version_check" CHECK ("decks"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "decks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cadence_id" uuid NOT NULL,
	"origin" text DEFAULT 'native' NOT NULL,
	"rating" text,
	"recalled" boolean,
	"duration_ms" integer,
	"sequence" integer NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_cadence_id_request_id_key" UNIQUE("cadence_id","request_id"),
	CONSTRAINT "review_events_cadence_id_sequence_key" UNIQUE("cadence_id","sequence"),
	CONSTRAINT "review_events_origin_check" CHECK ("review_events"."origin" in ('native', 'imported')),
	CONSTRAINT "review_events_rating_check" CHECK ("review_events"."rating" is null or "review_events"."rating" in ('again', 'hard', 'good', 'easy')),
	CONSTRAINT "review_events_result_check" CHECK (("review_events"."origin" = 'native' and "review_events"."rating" is not null) or ("review_events"."origin" = 'imported' and ("review_events"."rating" is not null or "review_events"."recalled" is not null))),
	CONSTRAINT "review_events_duration_ms_check" CHECK ("review_events"."duration_ms" is null or "review_events"."duration_ms" >= 0),
	CONSTRAINT "review_events_sequence_check" CHECK ("review_events"."sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "review_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card_cadences" ADD CONSTRAINT "card_cadences_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_revisions" ADD CONSTRAINT "card_revisions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_cadence_id_card_cadences_id_fk" FOREIGN KEY ("cadence_id") REFERENCES "public"."card_cadences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_cadences_new_order_idx" ON "card_cadences" USING btree ("card_id","direction","id") WHERE next_review_at is null;--> statement-breakpoint
CREATE INDEX "card_cadences_review_order_idx" ON "card_cadences" USING btree ("next_review_at","id") WHERE next_review_at is not null;--> statement-breakpoint
CREATE INDEX "card_revisions_card_created_idx" ON "card_revisions" USING btree ("card_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "cards_deck_id_idx" ON "cards" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "decks_user_id_idx" ON "decks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_events_cadence_sequence_idx" ON "review_events" USING btree ("cadence_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "card_cadences select own" ON "card_cadences" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));--> statement-breakpoint
CREATE POLICY "card_cadences insert own" ON "card_cadences" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));--> statement-breakpoint
CREATE POLICY "card_cadences update own" ON "card_cadences" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));--> statement-breakpoint
CREATE POLICY "card_cadences delete own" ON "card_cadences" AS PERMISSIVE FOR DELETE TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_cadences"."card_id"));--> statement-breakpoint
CREATE POLICY "card_revisions select own" ON "card_revisions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_revisions"."card_id"));--> statement-breakpoint
CREATE POLICY "card_revisions insert own" ON "card_revisions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_revisions"."card_id"));--> statement-breakpoint
CREATE POLICY "card_revisions update own" ON "card_revisions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_revisions"."card_id"));--> statement-breakpoint
CREATE POLICY "card_revisions delete own" ON "card_revisions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (exists (select 1 from cards join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where cards.id = "card_revisions"."card_id"));--> statement-breakpoint
CREATE POLICY "cards select own" ON "cards" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from decks where decks.id = "cards"."deck_id" and decks.user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "cards insert own" ON "cards" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from decks where decks.id = "cards"."deck_id" and decks.user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "cards update own" ON "cards" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (exists (select 1 from decks where decks.id = "cards"."deck_id" and decks.user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "cards delete own" ON "cards" AS PERMISSIVE FOR DELETE TO "authenticated" USING (exists (select 1 from decks where decks.id = "cards"."deck_id" and decks.user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "decks select own" ON "decks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "decks insert own" ON "decks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "decks update own" ON "decks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "decks delete own" ON "decks" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "review_events select own" ON "review_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));--> statement-breakpoint
CREATE POLICY "review_events insert own" ON "review_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));--> statement-breakpoint
CREATE POLICY "review_events update own" ON "review_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));--> statement-breakpoint
CREATE POLICY "review_events delete own" ON "review_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (exists (select 1 from card_cadences join cards on cards.id = card_cadences.card_id join decks on decks.id = cards.deck_id and decks.user_id = auth.uid() where card_cadences.id = "review_events"."cadence_id"));