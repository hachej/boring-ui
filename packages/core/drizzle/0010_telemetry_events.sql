CREATE TABLE IF NOT EXISTS "telemetry_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" text NOT NULL,
  "event_name" text NOT NULL,
  "distinct_id" text DEFAULT 'anonymous' NOT NULL,
  "properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_app_created_at_idx" ON "telemetry_events" USING btree ("app_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_event_name_idx" ON "telemetry_events" USING btree ("event_name");
