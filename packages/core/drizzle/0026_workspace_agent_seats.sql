-- Keep this rollout additive for older writers. A later cutover migration may
-- validate a NOT NULL default only after every writer creates defaults + Seats.
ALTER TABLE "workspaces"
  DROP CONSTRAINT IF EXISTS "workspaces_default_agent_type_id_required_check";
--> statement-breakpoint
CREATE TABLE "workspace_agent_seats" (
  "seat_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "agent_type_id" text NOT NULL,
  "source" text NOT NULL,
  "enrolled_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_agent_seats_agent_type_id_check"
    CHECK ("workspace_agent_seats"."agent_type_id" ~ '^[a-z][a-z0-9-]{0,62}$'),
  CONSTRAINT "workspace_agent_seats_source_check"
    CHECK ("workspace_agent_seats"."source" IN ('signup-intent', 'generic-default', 'user-add', 'migration-default', 'migration-session', 'operator'))
);
--> statement-breakpoint
ALTER TABLE "workspace_agent_seats"
  ADD CONSTRAINT "workspace_agent_seats_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_agent_seats"
  ADD CONSTRAINT "workspace_agent_seats_enrolled_by_user_id_users_id_fk"
  FOREIGN KEY ("enrolled_by_user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_agent_seats_workspace_agent_idx"
  ON "workspace_agent_seats" USING btree ("workspace_id", "agent_type_id");
--> statement-breakpoint
CREATE INDEX "workspace_agent_seats_workspace_id_idx"
  ON "workspace_agent_seats" USING btree ("workspace_id");
--> statement-breakpoint
INSERT INTO "workspace_agent_seats" (
  "workspace_id", "agent_type_id", "source", "enrolled_by_user_id"
)
SELECT "id", "default_agent_type_id", 'migration-default', "created_by"
FROM "workspaces"
WHERE "default_agent_type_id" IS NOT NULL
ON CONFLICT ("workspace_id", "agent_type_id") DO NOTHING;
