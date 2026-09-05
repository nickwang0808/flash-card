CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth.users" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "auth.users" CASCADE;--> statement-breakpoint
ALTER TABLE "decks" DROP CONSTRAINT "decks_user_id_auth.users_id_fk";
--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;