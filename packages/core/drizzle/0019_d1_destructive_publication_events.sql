CREATE TABLE "d1_destructive_publication_events" (
	"sequence" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"operation_id" text NOT NULL,
	"state" text NOT NULL,
	"host_id" text NOT NULL,
	"expected_revision" text NOT NULL,
	"expected_digest" text NOT NULL,
	"target_revision" text NOT NULL,
	"target_digest" text NOT NULL,
	"removal_binding_ids" text[] NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "d1_destructive_publication_state_check" CHECK ("state" IN ('prepared', 'committed', 'aborted')),
	CONSTRAINT "d1_destructive_publication_expected_revision_check" CHECK ("expected_revision" ~ '^r[0-9]{10}$'),
	CONSTRAINT "d1_destructive_publication_target_revision_check" CHECK ("target_revision" ~ '^r[0-9]{10}$'),
	CONSTRAINT "d1_destructive_publication_expected_digest_check" CHECK ("expected_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "d1_destructive_publication_target_digest_check" CHECK ("target_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "d1_destructive_publication_removals_check" CHECK (cardinality("removal_binding_ids") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "d1_destructive_publication_prepared_unique" ON "d1_destructive_publication_events" ("operation_id") WHERE "state" = 'prepared';
--> statement-breakpoint
CREATE UNIQUE INDEX "d1_destructive_publication_terminal_unique" ON "d1_destructive_publication_events" ("operation_id") WHERE "state" IN ('committed', 'aborted');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION d1_reject_destructive_publication_event_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'd1 destructive publication events are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER d1_destructive_publication_events_immutable
BEFORE UPDATE OR DELETE ON "d1_destructive_publication_events"
FOR EACH ROW EXECUTE FUNCTION d1_reject_destructive_publication_event_mutation();
--> statement-breakpoint
CREATE TRIGGER d1_destructive_publication_events_truncate_immutable
BEFORE TRUNCATE ON "d1_destructive_publication_events"
FOR EACH STATEMENT EXECUTE FUNCTION d1_reject_destructive_publication_event_mutation();
