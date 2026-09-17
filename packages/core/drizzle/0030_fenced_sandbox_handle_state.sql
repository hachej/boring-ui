ALTER TABLE "fenced_sandbox_handles" DROP CONSTRAINT "fenced_sandbox_handles_encryption_check";

ALTER TABLE "fenced_sandbox_handles" ADD COLUMN IF NOT EXISTS "handle_state" text;

UPDATE "fenced_sandbox_handles"
SET "handle_state" = 'published'
WHERE "encrypted_handle" IS NOT NULL;

ALTER TABLE "fenced_sandbox_handles" ADD CONSTRAINT "fenced_sandbox_handles_encryption_check" CHECK (
  ("encrypted_handle" IS NULL AND "encryption_nonce" IS NULL AND "encryption_auth_tag" IS NULL AND "encryption_version" IS NULL AND "handle_version" IS NULL AND "handle_state" IS NULL)
  OR ("encrypted_handle" IS NOT NULL AND "encryption_nonce" IS NOT NULL AND "encryption_auth_tag" IS NOT NULL AND "encryption_version" IS NOT NULL AND "handle_version" IS NOT NULL AND "handle_state" IS NOT NULL AND "handle_state" IN ('pending-validation', 'published'))
);
