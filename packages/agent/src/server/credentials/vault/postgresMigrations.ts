import type postgres from 'postgres'

/** Deployment-owned schema registration for durable credential vault storage. */
export async function runCredentialVaultPostgresMigrationsV1(
  sql: postgres.Sql,
): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_provider_credentials (
      workspace_id text NOT NULL,
      credential_subject_kind text NOT NULL DEFAULT 'workspace'
        CHECK (credential_subject_kind IN ('workspace', 'user')),
      credential_subject_id text NOT NULL DEFAULT '',
      provider_id text NOT NULL,
      credential_id text NOT NULL,
      display_label text NOT NULL,
      credential_type text NOT NULL,
      credential_schema_version integer NOT NULL DEFAULT 1
        CHECK (credential_schema_version > 0),
      state text NOT NULL CHECK (state IN (
        'active', 'disabled', 'revoked', 'needs_reauth',
        'intentionally_absent', 'instance_fallback_enabled'
      )),
      credential_version bigint NOT NULL
        CHECK (credential_version > 0 AND credential_version <= 9007199254740991),
      dek_generation bigint NOT NULL
        CHECK (dek_generation > 0 AND dek_generation <= 9007199254740991),
      material_kind text NOT NULL CHECK (material_kind IN ('field-set', 'none')),
      masked_last_four_suffix text,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, credential_subject_kind, credential_subject_id, provider_id),
      CHECK (
        (credential_subject_kind = 'workspace' AND credential_subject_id = '')
        OR (credential_subject_kind = 'user' AND credential_subject_id <> '')
      )
    )
  `)
  await sql.unsafe(`
    ALTER TABLE workspace_provider_credentials
      ADD COLUMN IF NOT EXISTS credential_subject_kind text NOT NULL DEFAULT 'workspace',
      ADD COLUMN IF NOT EXISTS credential_subject_id text NOT NULL DEFAULT ''
  `)
  await sql.unsafe(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace_provider_credentials'::regclass
          AND conname = 'workspace_provider_credentials_pkey'
          AND pg_get_constraintdef(oid) = 'PRIMARY KEY (workspace_id, provider_id)'
      ) THEN
        ALTER TABLE workspace_provider_credentials DROP CONSTRAINT workspace_provider_credentials_pkey;
        ALTER TABLE workspace_provider_credentials ADD PRIMARY KEY (
          workspace_id, credential_subject_kind, credential_subject_id, provider_id
        );
      END IF;
    END $$
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_credential_keys (
      workspace_id text NOT NULL,
      dek_generation bigint NOT NULL
        CHECK (dek_generation > 0 AND dek_generation <= 9007199254740991),
      kms_provider_id text NOT NULL,
      key_ref text NOT NULL,
      key_version bigint NOT NULL
        CHECK (key_version > 0 AND key_version <= 9007199254740991),
      payload_format text NOT NULL,
      payload_format_id text,
      ciphertext bytea,
      nonce bytea,
      auth_tag bytea,
      aad_context bytea,
      opaque_authenticated_payload bytea,
      state text NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'retired', 'destroyed')),
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, dek_generation)
    )
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_provider_credential_fields (
      workspace_id text NOT NULL,
      credential_subject_kind text NOT NULL DEFAULT 'workspace'
        CHECK (credential_subject_kind IN ('workspace', 'user')),
      credential_subject_id text NOT NULL DEFAULT '',
      provider_id text NOT NULL,
      credential_version bigint NOT NULL
        CHECK (credential_version > 0 AND credential_version <= 9007199254740991),
      field_id text NOT NULL,
      dek_generation bigint,
      envelope_version text,
      ciphertext bytea,
      nonce bytea,
      auth_tag bytea,
      aad_context bytea,
      deleted_at timestamptz,
      deletion_reason text,
      PRIMARY KEY (workspace_id, credential_subject_kind, credential_subject_id, provider_id, credential_version, field_id),
      CONSTRAINT workspace_provider_credential_fields_dek_fk
        FOREIGN KEY (workspace_id, dek_generation)
        REFERENCES workspace_credential_keys (workspace_id, dek_generation),
      CONSTRAINT workspace_provider_credential_fields_tombstone_check CHECK (
        (deleted_at IS NULL AND deletion_reason IS NULL
          AND dek_generation IS NOT NULL
          AND envelope_version IS NOT NULL AND ciphertext IS NOT NULL
          AND nonce IS NOT NULL AND auth_tag IS NOT NULL AND aad_context IS NOT NULL)
        OR
        (deleted_at IS NOT NULL AND deletion_reason IN ('superseded-version', 'credential-tombstone', 'crypto-shred')
          AND dek_generation IS NULL
          AND envelope_version IS NULL AND ciphertext IS NULL
          AND nonce IS NULL AND auth_tag IS NULL AND aad_context IS NULL)
      )
    )
  `)
  await sql.unsafe(`
    ALTER TABLE workspace_provider_credential_fields
      ADD COLUMN IF NOT EXISTS credential_subject_kind text NOT NULL DEFAULT 'workspace',
      ADD COLUMN IF NOT EXISTS credential_subject_id text NOT NULL DEFAULT ''
  `)
  await sql.unsafe(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace_provider_credential_fields'::regclass
          AND conname = 'workspace_provider_credential_fields_pkey'
          AND pg_get_constraintdef(oid) = 'PRIMARY KEY (workspace_id, provider_id, credential_version, field_id)'
      ) THEN
        ALTER TABLE workspace_provider_credential_fields DROP CONSTRAINT workspace_provider_credential_fields_pkey;
        ALTER TABLE workspace_provider_credential_fields ADD PRIMARY KEY (
          workspace_id, credential_subject_kind, credential_subject_id, provider_id, credential_version, field_id
        );
      END IF;
    END $$
  `)
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workspace_provider_credential_fields_tombstone_check'
          AND conrelid = 'workspace_provider_credential_fields'::regclass
          AND pg_get_constraintdef(oid) LIKE '%crypto-shred%'
      ) THEN
        ALTER TABLE workspace_provider_credential_fields
          DROP CONSTRAINT IF EXISTS workspace_provider_credential_fields_tombstone_check;
        ALTER TABLE workspace_provider_credential_fields
          ADD CONSTRAINT workspace_provider_credential_fields_tombstone_check CHECK (
            (deleted_at IS NULL AND deletion_reason IS NULL
              AND dek_generation IS NOT NULL
              AND envelope_version IS NOT NULL AND ciphertext IS NOT NULL
              AND nonce IS NOT NULL AND auth_tag IS NOT NULL AND aad_context IS NOT NULL)
            OR
            (deleted_at IS NOT NULL AND deletion_reason IN (
              'superseded-version', 'credential-tombstone', 'crypto-shred'
            ) AND dek_generation IS NULL
              AND envelope_version IS NULL AND ciphertext IS NULL
              AND nonce IS NULL AND auth_tag IS NULL AND aad_context IS NULL)
          ) NOT VALID;
      END IF;
    END $$
  `)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS workspace_provider_credential_fields_live_idx
      ON workspace_provider_credential_fields (workspace_id, credential_subject_kind, credential_subject_id, provider_id, credential_version)
      WHERE deleted_at IS NULL
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_credential_dek_rotations (
      workspace_id text PRIMARY KEY,
      operation_id text NOT NULL CHECK (length(operation_id) > 0),
      source_generation bigint NOT NULL CHECK (source_generation > 0),
      target_generation bigint NOT NULL CHECK (target_generation = source_generation + 1),
      phase text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `)
  await sql.unsafe(`
    ALTER TABLE workspace_credential_dek_rotations
      ADD COLUMN IF NOT EXISTS operation_id text
  `)
  await sql.unsafe(`
    UPDATE workspace_credential_dek_rotations
    SET operation_id = 'legacy:' || workspace_id || ':' || source_generation || ':' || target_generation
    WHERE operation_id IS NULL
  `)
  await sql.unsafe(`
    ALTER TABLE workspace_credential_dek_rotations
      ALTER COLUMN operation_id SET NOT NULL,
      DROP CONSTRAINT IF EXISTS workspace_credential_dek_rotations_operation_id_check,
      DROP CONSTRAINT IF EXISTS workspace_credential_dek_rotations_phase_check,
      ADD CONSTRAINT workspace_credential_dek_rotations_operation_id_check
        CHECK (length(operation_id) > 0),
      ADD CONSTRAINT workspace_credential_dek_rotations_phase_check
        CHECK (phase IN ('reencrypting', 'verified', 'anchor-advanced'))
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_credential_dek_rotation_receipts (
      workspace_id text NOT NULL,
      operation_id text NOT NULL CHECK (length(operation_id) > 0),
      source_generation bigint NOT NULL CHECK (source_generation > 0),
      target_generation bigint NOT NULL CHECK (target_generation = source_generation + 1),
      completed_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, operation_id)
    )
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_credential_shreds (
      workspace_id text PRIMARY KEY,
      shredded_at timestamptz NOT NULL
    )
  `)
}
