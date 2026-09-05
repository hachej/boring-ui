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
  CredentialLifecycleStateV1,
  CredentialVaultPersistenceV1,
  StoredCredentialMetadataV1,
  StoredCredentialRecordV1,
  WorkspaceDekRotationStateV1,
} from './persistence'

type Sql = postgres.Sql | postgres.TransactionSql

type CredentialRecordRow = {
  credential_id: string
  credential_version: string | number
  dek_generation: string | number
  material_kind: StoredCredentialRecordV1['materialKind']
}

type CredentialMetadataRow = {
  provider_id: ProviderId
  display_label: string
  credential_type: string
  state: CredentialLifecycleStateV1
  credential_version: string | number
  masked_last_four_suffix: string | null
  created_at: Date | string
  updated_at: Date | string
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
  field_id?: string
  envelope_version: string
  ciphertext: Uint8Array
  nonce: Uint8Array
  auth_tag: Uint8Array
  aad_context: Uint8Array
}

type RotationRow = {
  source_generation: string | number
  target_generation: string | number
  phase: WorkspaceDekRotationStateV1['phase']
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
  constructor(
    private readonly sql: Sql,
    private readonly lockedWorkspaceId?: string,
  ) {}

  async withWorkspaceLock<T>(
    workspaceId: string,
    mutate: (locked: CredentialVaultPersistenceV1) => Promise<T>,
  ): Promise<T> {
    if (this.lockedWorkspaceId === workspaceId) return mutate(this)
    if (!('reserve' in this.sql)) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        'Credential workspace lock is unavailable',
      )
    }
    const reserved = await this.sql.reserve()
    const lockKey = JSON.stringify(['credential-workspace', workspaceId])
    try {
      await reserved`SELECT pg_advisory_lock(hashtextextended(${lockKey}, 0))`
      return await mutate(new PostgresCredentialVaultPersistenceV1(reserved, workspaceId))
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtextextended(${lockKey}, 0))`
        .catch(() => undefined)
      reserved.release()
    }
  }

  private metadataFromRow(row: CredentialMetadataRow): StoredCredentialMetadataV1 {
    return Object.freeze({
      providerId: row.provider_id,
      displayLabel: row.display_label,
      credentialType: row.credential_type,
      state: row.state,
      credentialVersion: safeInteger(row.credential_version, 'credential version'),
      ...(row.masked_last_four_suffix === null ? {} : { maskedLastFourSuffix: row.masked_last_four_suffix }),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    })
  }

  async getCredentialMetadata(workspaceId: string, providerId: ProviderId) {
    const rows = await this.sql<CredentialMetadataRow[]>`
      SELECT provider_id, display_label, credential_type, state, credential_version,
        masked_last_four_suffix, created_at, updated_at
      FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
    `
    return rows[0] ? this.metadataFromRow(rows[0]) : undefined
  }

  async listCredentialMetadata(workspaceId: string) {
    const rows = await this.sql<CredentialMetadataRow[]>`
      SELECT provider_id, display_label, credential_type, state, credential_version,
        masked_last_four_suffix, created_at, updated_at
      FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId}
      ORDER BY provider_id
    `
    return Object.freeze(rows.map((row) => this.metadataFromRow(row)))
  }

  async hasWorkspaceCredentialArtifacts(workspaceId: string) {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT (
        EXISTS(SELECT 1 FROM workspace_provider_credentials WHERE workspace_id = ${workspaceId})
        OR EXISTS(SELECT 1 FROM workspace_credential_keys WHERE workspace_id = ${workspaceId})
        OR EXISTS(SELECT 1 FROM workspace_provider_credential_fields WHERE workspace_id = ${workspaceId})
        OR EXISTS(SELECT 1 FROM workspace_credential_dek_rotations WHERE workspace_id = ${workspaceId})
        OR EXISTS(SELECT 1 FROM workspace_credential_shreds WHERE workspace_id = ${workspaceId})
      ) AS exists
    `
    return rows[0]?.exists === true
  }

  async updateCredentialMetadata(
    workspaceId: string,
    providerId: ProviderId,
    update: Readonly<{
      state: CredentialLifecycleStateV1
      displayLabel?: string
      credentialType?: string
      maskedLastFourSuffix?: string | null
    }>,
  ) {
    const displayLabel = update.displayLabel ?? null
    const credentialType = update.credentialType ?? null
    const suffix = update.maskedLastFourSuffix ?? null
    const clearSuffix = update.maskedLastFourSuffix === null
    const rows = await this.sql<CredentialMetadataRow[]>`
      UPDATE workspace_provider_credentials
      SET state = ${update.state},
        display_label = COALESCE(${displayLabel}, display_label),
        credential_type = COALESCE(${credentialType}, credential_type),
        masked_last_four_suffix = CASE
          WHEN ${clearSuffix} THEN NULL
          ELSE COALESCE(${suffix}, masked_last_four_suffix)
        END,
        updated_at = NOW()
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
      RETURNING provider_id, display_label, credential_type, state, credential_version,
        masked_last_four_suffix, created_at, updated_at
    `
    if (!rows[0]) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
        'Credential material is not configured',
      )
    }
    return this.metadataFromRow(rows[0])
  }

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
    if ('begin' in this.sql) {
      if (!this.lockedWorkspaceId) {
        return this.withWorkspaceLock(input.workspaceId, async (locked) => {
          await locked.commitCredentialVersion(input)
        })
      }
      await this.sql.begin(async (transaction) => {
        await new PostgresCredentialVaultPersistenceV1(
          transaction,
          this.lockedWorkspaceId,
        ).commitCredentialVersion(input)
      })
      return
    }
    await this.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${JSON.stringify([input.workspaceId, input.providerId])}, 0)
      )
    `
    if (await this.isWorkspaceCryptoShredded(input.workspaceId)) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Workspace credential material was crypto-shredded',
      )
    }
    const rotation = await this.getDekRotationState(input.workspaceId)
    if (rotation && input.record.dekGeneration === rotation.sourceGeneration) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Credential write must retry against the active DEK generation',
      )
    }
    const current = await this.getCredentialRecord(input.workspaceId, input.providerId)
    if (
      current
      && current.dekGeneration !== input.record.dekGeneration
      && input.record.dekGeneration !== rotation?.targetGeneration
    ) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Credential DEK generation changed concurrently',
      )
    }
    if (!current && !rotation) {
      const workspaceRecords = await this.listCredentialRecords(input.workspaceId)
      const generations = new Set(workspaceRecords.map(({ record }) => record.dekGeneration))
      if (generations.size > 0 && !generations.has(input.record.dekGeneration)) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.UNREADABLE,
          'Credential DEK generation changed concurrently',
        )
      }
    }
    if ((current?.credentialVersion ?? 0) !== input.expectedCredentialVersion) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.UNREADABLE,
        'Credential record version changed concurrently',
      )
    }
    for (const [fieldId, envelope] of input.fields) {
      await this.putField({
        workspaceId: input.workspaceId,
        providerId: input.providerId,
        credentialVersion: input.record.credentialVersion,
        dekGeneration: input.record.dekGeneration,
        fieldId,
      }, envelope)
    }
    await this.putCredentialRecord(input.workspaceId, input.providerId, input.record)
    if (input.expectedCredentialVersion > 0 && input.supersededFieldsTombstone) {
      await this.tombstoneCredentialVersionFields(
        input.workspaceId,
        input.providerId,
        input.expectedCredentialVersion,
        input.supersededFieldsTombstone,
      )
    }
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
    if ('begin' in this.sql) {
      if (!this.lockedWorkspaceId) {
        return this.withWorkspaceLock(workspaceId, async (locked) => {
          await locked.putWrappedDek(workspaceId, dekGeneration, wrapped)
        })
      }
      await this.sql.begin(async (transaction) => {
        await new PostgresCredentialVaultPersistenceV1(
          transaction,
          this.lockedWorkspaceId,
        ).putWrappedDek(workspaceId, dekGeneration, wrapped)
      })
      return
    }
    if (await this.isWorkspaceCryptoShredded(workspaceId)) {
      unreadable('Workspace credential material was crypto-shredded')
    }
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

  async listCredentialRecords(workspaceId: string) {
    const rows = await this.sql<(CredentialRecordRow & { provider_id: ProviderId })[]>`
      SELECT provider_id, credential_id, credential_version, dek_generation, material_kind
      FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId}
      ORDER BY provider_id
    `
    return rows.map((row) => Object.freeze({
      providerId: row.provider_id,
      record: Object.freeze({
        credentialId: row.credential_id,
        credentialVersion: safeInteger(row.credential_version, 'credential version'),
        dekGeneration: safeInteger(row.dek_generation, 'DEK generation'),
        materialKind: row.material_kind,
      }),
    }))
  }

  async listFields(workspaceId: string, providerId: ProviderId, credentialVersion: number) {
    const rows = await this.sql<FieldRow[]>`
      SELECT field_id, envelope_version, ciphertext, nonce, auth_tag, aad_context
      FROM workspace_provider_credential_fields
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
        AND credential_version = ${credentialVersion} AND deleted_at IS NULL
      ORDER BY field_id
    `
    const result = new Map<string, CredentialEnvelopeV1>()
    for (const row of rows) {
      if (!row.field_id || row.envelope_version !== CREDENTIAL_ENVELOPE_VERSION) {
        unreadable('Malformed credential field row')
      }
      result.set(row.field_id, Object.freeze({
        envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
        ciphertext: bytes(row.ciphertext),
        nonce: bytes(row.nonce),
        authTag: bytes(row.auth_tag),
        aadContext: bytes(row.aad_context),
      }))
    }
    return result
  }

  async commitDekRotationRecord(input: import('./persistence').CommitDekRotationRecordInputV1) {
    if ('begin' in this.sql) {
      if (!this.lockedWorkspaceId) {
        return this.withWorkspaceLock(input.workspaceId, async (locked) => {
          await locked.commitDekRotationRecord(input)
        })
      }
      await this.sql.begin(async (transaction) => {
        await new PostgresCredentialVaultPersistenceV1(
          transaction,
          this.lockedWorkspaceId,
        ).commitDekRotationRecord(input)
      })
      return
    }
    await this.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${JSON.stringify([input.workspaceId, input.providerId])}, 0)
      )
    `
    if (await this.isWorkspaceCryptoShredded(input.workspaceId)) {
      unreadable('Workspace credential material was crypto-shredded')
    }
    const current = await this.getCredentialRecord(input.workspaceId, input.providerId)
    if (
      !current
      || current.credentialVersion !== input.expectedCredentialVersion
      || current.dekGeneration !== input.sourceGeneration
    ) unreadable('Credential record changed during DEK rotation')
    for (const [fieldId, envelope] of input.fields) {
      await this.putField({
        workspaceId: input.workspaceId,
        providerId: input.providerId,
        credentialVersion: current.credentialVersion,
        dekGeneration: input.targetGeneration,
        fieldId,
      }, envelope)
    }
    const updated = await this.sql`
      UPDATE workspace_provider_credentials
      SET dek_generation = ${input.targetGeneration}, updated_at = NOW()
      WHERE workspace_id = ${input.workspaceId} AND provider_id = ${input.providerId}
        AND credential_version = ${input.expectedCredentialVersion}
        AND dek_generation = ${input.sourceGeneration}
    `
    if (updated.count !== 1) unreadable('Credential record changed during DEK rotation')
  }

  async getDekRotationState(workspaceId: string) {
    const rows = await this.sql<RotationRow[]>`
      SELECT source_generation, target_generation, phase
      FROM workspace_credential_dek_rotations WHERE workspace_id = ${workspaceId}
    `
    const row = rows[0]
    return row ? Object.freeze({
      sourceGeneration: safeInteger(row.source_generation, 'source DEK generation'),
      targetGeneration: safeInteger(row.target_generation, 'target DEK generation'),
      phase: row.phase,
    }) : undefined
  }

  async putDekRotationState(workspaceId: string, state: WorkspaceDekRotationStateV1) {
    await this.sql`
      INSERT INTO workspace_credential_dek_rotations (
        workspace_id, source_generation, target_generation, phase
      ) VALUES (
        ${workspaceId}, ${state.sourceGeneration}, ${state.targetGeneration}, ${state.phase}
      )
      ON CONFLICT (workspace_id) DO UPDATE SET
        source_generation = EXCLUDED.source_generation,
        target_generation = EXCLUDED.target_generation,
        phase = EXCLUDED.phase,
        updated_at = NOW()
    `
  }

  async clearDekRotationState(workspaceId: string) {
    await this.sql`DELETE FROM workspace_credential_dek_rotations WHERE workspace_id = ${workspaceId}`
  }

  async isWorkspaceCryptoShredded(workspaceId: string) {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM workspace_credential_shreds WHERE workspace_id = ${workspaceId}
      ) AS exists
    `
    return rows[0]?.exists === true
  }

  async cryptoShredWorkspace(workspaceId: string, shreddedAt: string) {
    if ('begin' in this.sql) {
      if (!this.lockedWorkspaceId) {
        return this.withWorkspaceLock(workspaceId, async (locked) => {
          await locked.cryptoShredWorkspace(workspaceId, shreddedAt)
        })
      }
      await this.sql.begin(async (transaction) => {
        await new PostgresCredentialVaultPersistenceV1(
          transaction,
          this.lockedWorkspaceId,
        ).cryptoShredWorkspace(workspaceId, shreddedAt)
      })
      return
    }
    await this.sql`
      INSERT INTO workspace_credential_shreds (workspace_id, shredded_at)
      VALUES (${workspaceId}, ${shreddedAt})
      ON CONFLICT (workspace_id) DO NOTHING
    `
    await this.sql`
      UPDATE workspace_provider_credential_fields
      SET envelope_version = NULL, ciphertext = NULL, nonce = NULL,
        auth_tag = NULL, aad_context = NULL, dek_generation = NULL,
        deleted_at = ${shreddedAt}, deletion_reason = 'crypto-shred'
      WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    `
    await this.sql`DELETE FROM workspace_credential_keys WHERE workspace_id = ${workspaceId}`
    await this.sql`DELETE FROM workspace_credential_dek_rotations WHERE workspace_id = ${workspaceId}`
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
