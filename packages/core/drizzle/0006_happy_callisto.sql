CREATE TABLE "workspace_runtimes" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"sprite_url" text,
	"sprite_name" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provisioning_step" text,
	"step_started_at" timestamp,
	CONSTRAINT "workspace_runtimes_state_check" CHECK ("workspace_runtimes"."state" IN ('pending', 'provisioning', 'ready', 'error'))
);
--> statement-breakpoint
ALTER TABLE "workspace_runtimes" ADD CONSTRAINT "workspace_runtimes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;