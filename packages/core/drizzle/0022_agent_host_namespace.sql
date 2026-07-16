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
ALTER TRIGGER d1_destructive_publication_events_immutable ON "agent_host_destructive_publication_events" RENAME TO agent_host_destructive_publication_events_immutable;
--> statement-breakpoint
ALTER TRIGGER d1_destructive_publication_events_truncate_immutable ON "agent_host_destructive_publication_events" RENAME TO agent_host_destructive_publication_events_truncate_immutable;
