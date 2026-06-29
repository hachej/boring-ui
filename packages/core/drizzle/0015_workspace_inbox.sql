CREATE TABLE "workspace_inbox_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "source_label" text DEFAULT '' NOT NULL,
  "session_id" text,
  "target_label" text DEFAULT '' NOT NULL,
  "artifact" jsonb,
  "priority" integer DEFAULT 0 NOT NULL,
  "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "idempotency_hash" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_inbox_items_kind_check" CHECK ("workspace_inbox_items"."kind" IN ('question', 'review', 'approval', 'notice')),
  CONSTRAINT "workspace_inbox_items_status_check" CHECK ("workspace_inbox_items"."status" IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT "workspace_inbox_items_source_type_check" CHECK ("workspace_inbox_items"."source_type" IN ('external-hook', 'review', 'plugin', 'ask-user'))
);
--> statement-breakpoint
CREATE TABLE "workspace_inbox_item_view_states" (
  "workspace_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_inbox_item_view_states_workspace_id_item_id_user_id_pk" PRIMARY KEY("workspace_id","item_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_inbox_items" ADD CONSTRAINT "workspace_inbox_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inbox_item_view_states" ADD CONSTRAINT "workspace_inbox_item_view_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inbox_item_view_states" ADD CONSTRAINT "workspace_inbox_item_view_states_item_id_workspace_inbox_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."workspace_inbox_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inbox_item_view_states" ADD CONSTRAINT "workspace_inbox_item_view_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_inbox_items_idempotency_idx" ON "workspace_inbox_items" USING btree ("workspace_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_inbox_items_source_idx" ON "workspace_inbox_items" USING btree ("workspace_id","source_type","source_id");
--> statement-breakpoint
CREATE INDEX "workspace_inbox_items_workspace_status_idx" ON "workspace_inbox_items" USING btree ("workspace_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX "workspace_inbox_item_view_states_user_idx" ON "workspace_inbox_item_view_states" USING btree ("workspace_id","user_id");
