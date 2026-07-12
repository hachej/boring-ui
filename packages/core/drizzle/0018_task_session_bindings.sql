CREATE TABLE "boring_task_session_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"adapter_id" text NOT NULL,
	"task_id" text NOT NULL,
	"session_id" text NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "boring_task_session_bindings_tuple_idx" ON "boring_task_session_bindings" USING btree ("workspace_id","adapter_id","task_id","session_id");--> statement-breakpoint
CREATE INDEX "boring_task_session_bindings_task_idx" ON "boring_task_session_bindings" USING btree ("workspace_id","adapter_id","task_id","created_at");
