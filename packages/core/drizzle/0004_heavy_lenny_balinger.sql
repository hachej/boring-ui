CREATE TABLE "workspace_settings" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" "bytea" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_workspace_id_key_pk" PRIMARY KEY("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;