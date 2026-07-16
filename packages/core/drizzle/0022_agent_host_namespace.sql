ALTER TABLE "d1_binding_admissions" RENAME TO "agent_host_binding_admissions";
--> statement-breakpoint
ALTER SEQUENCE "d1_binding_admissions_sequence_seq" RENAME TO "agent_host_binding_admissions_sequence_seq";
--> statement-breakpoint
ALTER TABLE "agent_host_binding_admissions" RENAME CONSTRAINT "d1_binding_admissions_pk" TO "agent_host_binding_admissions_pk";
--> statement-breakpoint
ALTER TABLE "agent_host_binding_admissions" RENAME CONSTRAINT "d1_binding_admissions_revision_check" TO "agent_host_binding_admissions_revision_check";
--> statement-breakpoint
ALTER TABLE "agent_host_binding_admissions" RENAME CONSTRAINT "d1_binding_admissions_execution_digest_check" TO "agent_host_binding_admissions_execution_digest_check";
--> statement-breakpoint
ALTER TABLE "agent_host_binding_admissions" RENAME CONSTRAINT "d1_binding_admissions_desired_digest_check" TO "agent_host_binding_admissions_desired_digest_check";
--> statement-breakpoint
ALTER INDEX "d1_binding_admissions_sequence_unique" RENAME TO "agent_host_binding_admissions_sequence_unique";
--> statement-breakpoint
ALTER TABLE "d1_destructive_publication_events" RENAME TO "agent_host_destructive_publication_events";
--> statement-breakpoint
ALTER SEQUENCE "d1_destructive_publication_events_sequence_seq" RENAME TO "agent_host_destructive_publication_events_sequence_seq";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_events_pkey" TO "agent_host_destructive_publication_events_pkey";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_state_check" TO "agent_host_destructive_publication_state_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_expected_revision_check" TO "agent_host_destructive_publication_expected_revision_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_target_revision_check" TO "agent_host_destructive_publication_target_revision_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_expected_digest_check" TO "agent_host_destructive_publication_expected_digest_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_target_digest_check" TO "agent_host_destructive_publication_target_digest_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_removals_check" TO "agent_host_destructive_publication_removals_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_source_pair_check" TO "agent_host_destructive_publication_source_pair_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_source_revision_check" TO "agent_host_destructive_publication_source_revision_check";
--> statement-breakpoint
ALTER TABLE "agent_host_destructive_publication_events" RENAME CONSTRAINT "d1_destructive_publication_source_digest_check" TO "agent_host_destructive_publication_source_digest_check";
--> statement-breakpoint
ALTER INDEX "d1_destructive_publication_prepared_unique" RENAME TO "agent_host_destructive_publication_prepared_unique";
--> statement-breakpoint
ALTER INDEX "d1_destructive_publication_terminal_unique" RENAME TO "agent_host_destructive_publication_terminal_unique";
--> statement-breakpoint
ALTER FUNCTION d1_reject_destructive_publication_event_mutation() RENAME TO agent_host_reject_destructive_publication_event_mutation;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION agent_host_reject_destructive_publication_event_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'agent-host destructive publication events are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
ALTER TRIGGER d1_destructive_publication_events_immutable ON "agent_host_destructive_publication_events" RENAME TO agent_host_destructive_publication_events_immutable;
--> statement-breakpoint
ALTER TRIGGER d1_destructive_publication_events_truncate_immutable ON "agent_host_destructive_publication_events" RENAME TO agent_host_destructive_publication_events_truncate_immutable;
--> statement-breakpoint
DO $$
DECLARE
	constraint_record record;
BEGIN
	-- PostgreSQL 18 exposes NOT NULL constraints as named pg_constraint rows;
	-- PostgreSQL 16/17 keep the same invariant only in pg_attribute. Rename every
	-- legacy named NOT NULL object when the catalog supports it, without making
	-- the forward migration fail on supported versions where those rows do not exist.
	FOR constraint_record IN
		SELECT constraint_name, table_name
		FROM (
			VALUES
				('d1_binding_admissions_sequence_not_null', 'agent_host_binding_admissions'),
				('d1_binding_admissions_host_id_not_null', 'agent_host_binding_admissions'),
				('d1_binding_admissions_binding_id_not_null', 'agent_host_binding_admissions'),
				('d1_binding_admissions_active_revision_not_null', 'agent_host_binding_admissions'),
				('d1_binding_admissions_admitted_at_not_null', 'agent_host_binding_admissions'),
				('d1_destructive_publication_events_sequence_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_operation_id_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_state_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_host_id_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_expected_revision_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_expected_digest_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_target_revision_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_target_digest_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_removal_binding_ids_not_null', 'agent_host_destructive_publication_events'),
				('d1_destructive_publication_events_recorded_at_not_null', 'agent_host_destructive_publication_events')
		) AS expected(constraint_name, table_name)
		WHERE EXISTS (
			SELECT 1
			FROM pg_constraint constraint_catalog
			JOIN pg_class relation_catalog ON relation_catalog.oid = constraint_catalog.conrelid
			JOIN pg_namespace namespace_catalog ON namespace_catalog.oid = relation_catalog.relnamespace
			WHERE namespace_catalog.nspname = current_schema()
				AND relation_catalog.relname = expected.table_name
				AND constraint_catalog.conname = expected.constraint_name
				AND constraint_catalog.contype = 'n'
		)
	LOOP
		EXECUTE format(
			'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
			current_schema(),
			constraint_record.table_name,
			constraint_record.constraint_name,
			regexp_replace(constraint_record.constraint_name, '^d1_', 'agent_host_')
		);
	END LOOP;
END;
$$;
