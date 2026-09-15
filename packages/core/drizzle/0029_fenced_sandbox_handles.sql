-- Host-owned sandbox identity only. Shared EFS namespace/data is intentionally absent.
CREATE TABLE IF NOT EXISTS "fenced_sandbox_handles" (
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
  "cleanup_outcome" text,
  "cleanup_detail" text,
  "cleanup_recorded_at" timestamptz,
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
    ("encrypted_handle" IS NULL AND "encryption_nonce" IS NULL AND "encryption_auth_tag" IS NULL AND "encryption_version" IS NULL AND "handle_version" IS NULL)
    OR ("encrypted_handle" IS NOT NULL AND "encryption_nonce" IS NOT NULL AND "encryption_auth_tag" IS NOT NULL AND "encryption_version" IS NOT NULL AND "handle_version" IS NOT NULL)
  )
);

-- Claim locks the discriminator row with SELECT ... FOR UPDATE. Every mutation uses
-- conditional generation/token/expiry SQL. Cleanup fields are updated before successful
-- deletion in the same transaction; failures/debt remain durable.
