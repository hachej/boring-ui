import type postgres from 'postgres'

/** Deployment-owned schema registration for durable credential vault storage. */
export async function runCredentialVaultPostgresMigrationsV1(
  sql: postgres.Sql,
): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_provider_credentials (
      workspace_id text NOT NULL,
      provider_id text NOT NULL,
      credential_id text NOT NULL,
      credential_version bigint NOT NULL CHECK (credential_version > 0),
      dek_generation bigint NOT NULL CHECK (dek_generation > 0),
      material_kind text NOT NULL CHECK (material_kind IN ('field-set', 'none')),
      PRIMARY KEY (workspace_id, provider_id)
    )
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_credential_keys (
      workspace_id text NOT NULL,
      dek_generation bigint NOT NULL CHECK (dek_generation > 0),
      kms_provider_id text NOT NULL,
      key_ref text NOT NULL,
      key_version bigint NOT NULL CHECK (key_version > 0),
      payload_format text NOT NULL,
      payload_format_id text,
      ciphertext bytea,
      nonce bytea,
      auth_tag bytea,
      aad_context bytea,
      opaque_authenticated_payload bytea,
      PRIMARY KEY (workspace_id, dek_generation)
    )
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_provider_credential_fields (
      workspace_id text NOT NULL,
      provider_id text NOT NULL,
      credential_version bigint NOT NULL CHECK (credential_version > 0),
      field_id text NOT NULL,
      dek_generation bigint,
      envelope_version text,
      ciphertext bytea,
      nonce bytea,
      auth_tag bytea,
      aad_context bytea,
      deleted_at timestamptz,
      deletion_reason text,
      PRIMARY KEY (workspace_id, provider_id, credential_version, field_id),
      CONSTRAINT workspace_provider_credential_fields_dek_fk
        FOREIGN KEY (workspace_id, dek_generation)
        REFERENCES workspace_credential_keys (workspace_id, dek_generation),
      CONSTRAINT workspace_provider_credential_fields_tombstone_check CHECK (
        (deleted_at IS NULL AND deletion_reason IS NULL
          AND dek_generation IS NOT NULL
          AND envelope_version IS NOT NULL AND ciphertext IS NOT NULL
          AND nonce IS NOT NULL AND auth_tag IS NOT NULL AND aad_context IS NOT NULL)
        OR
        (deleted_at IS NOT NULL AND deletion_reason IN ('superseded-version', 'credential-tombstone')
          AND dek_generation IS NULL
          AND envelope_version IS NULL AND ciphertext IS NULL
          AND nonce IS NULL AND auth_tag IS NULL AND aad_context IS NULL)
      )
    )
  `)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS workspace_provider_credential_fields_live_idx
      ON workspace_provider_credential_fields (workspace_id, provider_id, credential_version)
      WHERE deleted_at IS NULL
  `)
}
