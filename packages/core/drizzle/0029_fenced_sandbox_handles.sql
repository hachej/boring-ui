-- Host-owned sandbox identity only. Shared EFS namespace/data is intentionally absent.
CREATE TABLE "fenced_sandbox_handles" (
  "host_scope" text NOT NULL,
  "workspace_id" text NOT NULL,
  "provider" text NOT NULL,
  "mode" text NOT NULL,
  "generation" bigint NOT NULL DEFAULT 0,
  "lease_owner" text,
  "lease_token" uuid,
  "lease_expires_at" timestamptz,
  "encrypted_handle" bytea,
  "encryption_nonce" bytea,
  "encryption_auth_tag" bytea,
  "encryption_version" integer,
  "handle_version" integer,
  "handle_state" text,
  "create_attempt_idempotency_key" uuid,
  "create_attempt_state" text,
  "create_attempt_started_at" timestamptz,
  "create_attempt_resolved_at" timestamptz,
  "cleanup_outcome" text,
  "cleanup_detail" text,
  "cleanup_recorded_at" timestamptz,
  "tombstoned_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("host_scope", "workspace_id", "provider", "mode"),
  CONSTRAINT "fenced_sandbox_handles_lease_check" CHECK (
    ("lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
    OR ("lease_owner" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
  ),
  CONSTRAINT "fenced_sandbox_handles_cleanup_check" CHECK (
    ("cleanup_outcome" IS NULL AND "cleanup_detail" IS NULL AND "cleanup_recorded_at" IS NULL)
    OR ("cleanup_outcome" IN ('succeeded', 'failed', 'ambiguous') AND "cleanup_recorded_at" IS NOT NULL)
  ),
  CONSTRAINT "fenced_sandbox_handles_encryption_check" CHECK (
    ("encrypted_handle" IS NULL AND "encryption_nonce" IS NULL AND "encryption_auth_tag" IS NULL AND "encryption_version" IS NULL AND "handle_version" IS NULL AND "handle_state" IS NULL)
    OR ("encrypted_handle" IS NOT NULL AND "encryption_nonce" IS NOT NULL AND "encryption_auth_tag" IS NOT NULL AND "encryption_version" IS NOT NULL AND "handle_version" IS NOT NULL AND "handle_state" IN ('pending-validation', 'published'))
  ),
  CONSTRAINT "fenced_sandbox_handles_create_attempt_check" CHECK (
    ("create_attempt_idempotency_key" IS NULL AND "create_attempt_state" IS NULL AND "create_attempt_started_at" IS NULL AND "create_attempt_resolved_at" IS NULL)
    OR ("create_attempt_idempotency_key" IS NOT NULL AND "create_attempt_state" = 'started' AND "create_attempt_started_at" IS NOT NULL AND "create_attempt_resolved_at" IS NULL)
    OR ("create_attempt_idempotency_key" IS NOT NULL AND "create_attempt_state" = 'completed' AND "create_attempt_started_at" IS NOT NULL AND "create_attempt_resolved_at" IS NOT NULL)
  ),
  CONSTRAINT "fenced_sandbox_handles_tombstone_check" CHECK (
    "tombstoned_at" IS NULL
    OR ("lease_owner" IS NULL AND "encrypted_handle" IS NULL AND "create_attempt_state" IS NULL AND "cleanup_outcome" = 'succeeded')
  )
);

CREATE TABLE "fenced_sandbox_handle_audit" (
  "audit_id" text PRIMARY KEY,
  "host_scope" text NOT NULL,
  "workspace_id" text NOT NULL,
  "provider" text NOT NULL,
  "mode" text NOT NULL,
  "generation" bigint NOT NULL,
  "action" text NOT NULL,
  "operator_id" text NOT NULL,
  "evidence_detail" text NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "fenced_sandbox_handle_audit_action_check" CHECK (
    "action" IN ('reconcile-create-absent', 'reconcile-create-refused-active-lease', 'reconcile-delete', 'reconcile-delete-refused-active-lease')
  )
);

-- Claim locks the discriminator row with SELECT ... FOR UPDATE. Every mutation uses
-- conditional generation/token/expiry SQL. Successful deletion is an atomic tombstone
-- update, retaining generation and its cleanup-success receipt while clearing secrets.
