import type postgres from 'postgres'
import {
  CREDENTIAL_ENVELOPE_VERSION,
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type {
  CredentialEnvelopeV1,
  ProviderId,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import type {
  CommitCredentialVersionInputV1,
  CredentialFieldKeyV1,
  CredentialFieldTombstoneV1,
  CredentialVaultPersistenceV1,
  StoredCredentialRecordV1,
} from './persistence'

type Sql = postgres.Sql | postgres.TransactionSql

type CredentialRecordRow = {
  credential_id: string
  credential_version: string | number
  dek_generation: string | number
  material_kind: StoredCredentialRecordV1['materialKind']
}

type WrappedDekRow = {
  kms_provider_id: string
  key_ref: string
  key_version: string | number
  payload_format: string
  payload_format_id: string | null
  ciphertext: Uint8Array | null
  nonce: Uint8Array | null
  auth_tag: Uint8Array | null
  aad_context: Uint8Array | null
  opaque_authenticated_payload: Uint8Array | null
}

type FieldRow = {
  envelope_version: string
  ciphertext: Uint8Array
  nonce: Uint8Array
  auth_tag: Uint8Array
  aad_context: Uint8Array
}

type TombstoneRow = {
  deleted_at: Date | string
  deletion_reason: CredentialFieldTombstoneV1['reason']
}

function unreadable(message: string): never {
  throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.UNREADABLE, message)
}

function safeInteger(value: string | number, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    unreadable(`Invalid credential vault ${label}`)
  }
  return parsed
}

function bytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value)
}

/** Postgres implementation of the ciphertext-only credential vault port. */
export class PostgresCredentialVaultPersistenceV1
implements CredentialVaultPersistenceV1 {
  constructor(private readonly sql: Sql) {}

  async getCredentialRecord(
    workspaceId: string,
    providerId: ProviderId,
  ): Promise<StoredCredentialRecordV1 | undefined> {
    const rows = await this.sql<CredentialRecordRow[]>`
      SELECT credential_id, credential_version, dek_generation, material_kind
      FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
    `
    const row = rows[0]
    if (!row) return undefined
    return Object.freeze({
      credentialId: row.credential_id,
      credentialVersion: safeInteger(row.credential_version, 'credential version'),
      dekGeneration: safeInteger(row.dek_generation, 'DEK generation'),
      materialKind: row.material_kind,
    })
  }

  async putCredentialRecord(
    workspaceId: string,
    providerId: ProviderId,
    record: StoredCredentialRecordV1,
  ): Promise<void> {
    await this.sql`
      INSERT INTO workspace_provider_credentials (
        workspace_id, provider_id, credential_id, display_label,
        credential_type, credential_schema_version, state, credential_version,
        dek_generation, material_kind
      ) VALUES (
        ${workspaceId}, ${providerId}, ${record.credentialId}, ${providerId},
        'field-set.v1', 1,
        ${record.materialKind === 'none' ? 'intentionally_absent' : 'active'},
        ${record.credentialVersion}, ${record.dekGeneration}, ${record.materialKind}
      )
      ON CONFLICT (workspace_id, provider_id) DO UPDATE SET
        credential_id = EXCLUDED.credential_id,
        credential_version = EXCLUDED.credential_version,
        dek_generation = EXCLUDED.dek_generation,
        material_kind = EXCLUDED.material_kind,
        state = EXCLUDED.state,
        updated_at = NOW()
    `
  }

  async commitCredentialVersion(
    input: CommitCredentialVersionInputV1,
  ): Promise<void> {
    if (!('begin' in this.sql)) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        'Credential persistence transaction is unavailable',
      )
    }
    await this.sql.begin(async (transaction) => {
      const scoped = new PostgresCredentialVaultPersistenceV1(transaction)
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${JSON.stringify([input.workspaceId, input.providerId])}, 0)
        )
      `
      const current = await scoped.getCredentialRecord(
        input.workspaceId,
        input.providerId,
      )
      if ((current?.credentialVersion ?? 0) !== input.expectedCredentialVersion) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Credential record version changed concurrently',
        )
      }
      for (const [fieldId, envelope] of input.fields) {
        await scoped.putField({
          workspaceId: input.workspaceId,
          providerId: input.providerId,
          credentialVersion: input.record.credentialVersion,
          dekGeneration: input.record.dekGeneration,
          fieldId,
        }, envelope)
      }
      await scoped.putCredentialRecord(
        input.workspaceId,
        input.providerId,
        input.record,
      )
      if (input.expectedCredentialVersion > 0 && input.supersededFieldsTombstone) {
        await scoped.tombstoneCredentialVersionFields(
          input.workspaceId,
          input.providerId,
          input.expectedCredentialVersion,
          input.supersededFieldsTombstone,
        )
      }
    })
  }

  async getWrappedDek(
    workspaceId: string,
    dekGeneration: number,
  ): Promise<WrappedWorkspaceDekV1 | undefined> {
    const rows = await this.sql<WrappedDekRow[]>`
      SELECT kms_provider_id, key_ref, key_version, payload_format,
        payload_format_id, ciphertext, nonce, auth_tag, aad_context,
        opaque_authenticated_payload
      FROM workspace_credential_keys
      WHERE workspace_id = ${workspaceId} AND dek_generation = ${dekGeneration}
    `
    const row = rows[0]
    if (!row) return undefined
    const common = {
      providerId: row.kms_provider_id,
      keyRef: row.key_ref,
      keyVersion: safeInteger(row.key_version, 'KEK version'),
    }
    if (row.payload_format === 'local-aes-256-gcm.v1') {
      if (!row.ciphertext || !row.nonce || !row.auth_tag || !row.aad_context) {
        unreadable('Malformed local wrapped DEK row')
      }
      return Object.freeze({
        ...common,
        payload: Object.freeze({
          format: row.payload_format,
          ciphertext: bytes(row.ciphertext),
          nonce: bytes(row.nonce),
          authTag: bytes(row.auth_tag),
          aadContext: bytes(row.aad_context),
        }),
      })
    }
    if (row.payload_format === 'vault-transit-ciphertext.v1') {
      if (!row.ciphertext) unreadable('Malformed Transit wrapped DEK row')
      return Object.freeze({
        ...common,
        payload: Object.freeze({
          format: row.payload_format,
          ciphertext: bytes(row.ciphertext),
        }),
      })
    }
    if (
      row.payload_format !== 'external-kms-opaque.v1'
      || !row.payload_format_id
      || !row.opaque_authenticated_payload
    ) {
      unreadable('Malformed external KMS wrapped DEK row')
    }
    return Object.freeze({
      ...common,
      payload: Object.freeze({
        format: 'external-kms-opaque.v1',
        payloadFormatId: row.payload_format_id,
        opaqueAuthenticatedPayload: bytes(row.opaque_authenticated_payload),
      }),
    })
  }

  async putWrappedDek(
    workspaceId: string,
    dekGeneration: number,
    wrapped: WrappedWorkspaceDekV1,
  ): Promise<void> {
    const payload = wrapped.payload
    const ciphertext = payload.format === 'local-aes-256-gcm.v1'
      || payload.format === 'vault-transit-ciphertext.v1'
      ? payload.ciphertext
      : null
    const nonce = payload.format === 'local-aes-256-gcm.v1' ? payload.nonce : null
    const authTag = payload.format === 'local-aes-256-gcm.v1' ? payload.authTag : null
    const aadContext = payload.format === 'local-aes-256-gcm.v1' ? payload.aadContext : null
    const payloadFormatId = payload.format === 'external-kms-opaque.v1'
      ? payload.payloadFormatId
      : null
    const opaquePayload = payload.format === 'external-kms-opaque.v1'
      ? payload.opaqueAuthenticatedPayload
      : null
    await this.sql`
      INSERT INTO workspace_credential_keys (
        workspace_id, dek_generation, kms_provider_id, key_ref, key_version,
        payload_format, payload_format_id, ciphertext, nonce, auth_tag,
        aad_context, opaque_authenticated_payload
      ) VALUES (
        ${workspaceId}, ${dekGeneration}, ${wrapped.providerId}, ${wrapped.keyRef},
        ${wrapped.keyVersion}, ${payload.format}, ${payloadFormatId}, ${ciphertext},
        ${nonce}, ${authTag}, ${aadContext}, ${opaquePayload}
      )
      ON CONFLICT (workspace_id, dek_generation) DO UPDATE SET
        kms_provider_id = EXCLUDED.kms_provider_id,
        key_ref = EXCLUDED.key_ref,
        key_version = EXCLUDED.key_version,
        payload_format = EXCLUDED.payload_format,
        payload_format_id = EXCLUDED.payload_format_id,
        ciphertext = EXCLUDED.ciphertext,
        nonce = EXCLUDED.nonce,
        auth_tag = EXCLUDED.auth_tag,
        aad_context = EXCLUDED.aad_context,
        opaque_authenticated_payload = EXCLUDED.opaque_authenticated_payload,
        state = 'active',
        updated_at = NOW()
    `
  }

  async deleteWrappedDek(workspaceId: string, dekGeneration: number): Promise<void> {
    await this.sql`
      DELETE FROM workspace_credential_keys
      WHERE workspace_id = ${workspaceId} AND dek_generation = ${dekGeneration}
    `
  }

  async getField(key: CredentialFieldKeyV1): Promise<CredentialEnvelopeV1 | undefined> {
    const rows = await this.sql<FieldRow[]>`
      SELECT envelope_version, ciphertext, nonce, auth_tag, aad_context
      FROM workspace_provider_credential_fields
      WHERE workspace_id = ${key.workspaceId}
        AND provider_id = ${key.providerId}
        AND credential_version = ${key.credentialVersion}
        AND field_id = ${key.fieldId}
        AND deleted_at IS NULL
    `
    const row = rows[0]
    if (!row) return undefined
    if (row.envelope_version !== CREDENTIAL_ENVELOPE_VERSION) {
      unreadable('Unsupported credential envelope version')
    }
    return Object.freeze({
      envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
      ciphertext: bytes(row.ciphertext),
      nonce: bytes(row.nonce),
      authTag: bytes(row.auth_tag),
      aadContext: bytes(row.aad_context),
    })
  }

  async putField(key: CredentialFieldKeyV1, envelope: CredentialEnvelopeV1): Promise<void> {
    const dekGeneration = key.dekGeneration
    if (!Number.isSafeInteger(dekGeneration) || dekGeneration! <= 0) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
        'Credential field DEK generation is required',
      )
    }
    const result = await this.sql`
      INSERT INTO workspace_provider_credential_fields (
        workspace_id, provider_id, credential_version, field_id, dek_generation,
        envelope_version, ciphertext, nonce, auth_tag, aad_context,
        deleted_at, deletion_reason
      ) VALUES (
        ${key.workspaceId}, ${key.providerId}, ${key.credentialVersion}, ${key.fieldId},
        ${dekGeneration!}, ${envelope.envelopeVersion}, ${envelope.ciphertext},
        ${envelope.nonce}, ${envelope.authTag}, ${envelope.aadContext}, NULL, NULL
      )
      ON CONFLICT (workspace_id, provider_id, credential_version, field_id)
      DO UPDATE SET
        envelope_version = EXCLUDED.envelope_version,
        ciphertext = EXCLUDED.ciphertext,
        nonce = EXCLUDED.nonce,
        auth_tag = EXCLUDED.auth_tag,
        aad_context = EXCLUDED.aad_context,
        dek_generation = EXCLUDED.dek_generation,
        deleted_at = NULL,
        deletion_reason = NULL
      WHERE workspace_provider_credential_fields.deleted_at IS NULL
    `
    if (result.count === 0) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Credential field tombstone cannot be resurrected',
      )
    }
  }

  async tombstoneCredentialVersionFields(
    workspaceId: string,
    providerId: ProviderId,
    credentialVersion: number,
    tombstone: CredentialFieldTombstoneV1,
  ): Promise<void> {
    await this.sql`
      UPDATE workspace_provider_credential_fields
      SET envelope_version = NULL, ciphertext = NULL, nonce = NULL,
        auth_tag = NULL, aad_context = NULL, dek_generation = NULL,
        deleted_at = ${tombstone.deletedAt}, deletion_reason = ${tombstone.reason}
      WHERE workspace_id = ${workspaceId}
        AND provider_id = ${providerId}
        AND credential_version = ${credentialVersion}
    `
  }

  async getFieldTombstone(
    key: CredentialFieldKeyV1,
  ): Promise<CredentialFieldTombstoneV1 | undefined> {
    const rows = await this.sql<TombstoneRow[]>`
      SELECT deleted_at, deletion_reason
      FROM workspace_provider_credential_fields
      WHERE workspace_id = ${key.workspaceId}
        AND provider_id = ${key.providerId}
        AND credential_version = ${key.credentialVersion}
        AND field_id = ${key.fieldId}
        AND deleted_at IS NOT NULL
    `
    const row = rows[0]
    if (!row) return undefined
    return Object.freeze({
      deletedAt: row.deleted_at instanceof Date
        ? row.deleted_at.toISOString()
        : new Date(row.deleted_at).toISOString(),
      reason: row.deletion_reason,
    })
  }
}

export function createPostgresCredentialVaultPersistenceV1(
  sql: Sql,
): CredentialVaultPersistenceV1 {
  return Object.freeze(new PostgresCredentialVaultPersistenceV1(sql))
}
