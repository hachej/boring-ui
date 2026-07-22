import { randomUUID } from 'node:crypto'

import {
  createWorkspaceKekProviderSelectorV1,
  decryptField,
  encryptField,
} from '@hachej/boring-agent/server'
import type { CredentialStoreBackendV1 } from '@hachej/boring-agent/server'
import {
  CREDENTIAL_ENVELOPE_VERSION,
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '@hachej/boring-agent/shared'
import type {
  CredentialEnvelopeV1,
  CredentialFieldId,
  ProviderId,
  ResolvedCredentialMaterialV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '@hachej/boring-agent/shared'
import { and, eq, inArray, sql as drizzleSql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import {
  workspaceCredentialKeys,
  workspaceProviderCredentialFields,
  workspaceProviderCredentials,
} from '../schema.js'
import {
  deserializeCredentialWrappedDekV1,
  serializeCredentialWrappedDekV1,
} from './credentialWrappedDekCodec.js'

const CREDENTIAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_CREDENTIAL_FIELDS_V1 = 16
const MAX_CREDENTIAL_FIELD_BYTES_V1 = 65_536
const MAX_LABEL_BYTES_V1 = 256
const MIN_SAFE_MASK_BYTES_V1 = 8

export type WorkspaceProviderCredentialStateV1 =
  | 'active'
  | 'disabled'
  | 'revoked'
  | 'needs_reauth'
  | 'intentionally_absent'
  | 'instance_fallback_enabled'

export interface PutCredentialInputV1 {
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly displayLabel: string
  readonly credentialType: string
  readonly credentialSchemaVersion: number
  readonly dekGeneration: number
  readonly fields: ReadonlyMap<CredentialFieldId, Uint8Array>
  readonly maskFieldId?: CredentialFieldId
  readonly actorId: string
  readonly requestId: string
}

export interface PutCredentialResultV1 {
  readonly credentialVersion: number
  readonly dekGeneration: number
  readonly maskedLastFourSuffix: string
}

export interface PostgresCredentialVaultStoreOptionsV1 {
  readonly databaseUrl: string
  readonly kekProvider: WorkspaceKekProviderV1
  readonly maxConnections?: number
}

function unreadable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    'Credential vault material is unreadable',
  )
}

function backendUnavailable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    'Credential vault backend is unavailable',
    { retryable: true },
  )
}

function schemaMismatch(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    'Credential vault input is invalid',
  )
}

function assertBoundedText(value: string, maximum: number): void {
  if (
    typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > maximum
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw schemaMismatch()
  }
}

function assertCredentialId(value: string): void {
  if (typeof value !== 'string' || !CREDENTIAL_ID_PATTERN.test(value)) {
    throw schemaMismatch()
  }
}

function assertPositiveSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw schemaMismatch()
}

function validatePutInput(input: PutCredentialInputV1): ReadonlyArray<readonly [
  CredentialFieldId,
  Uint8Array,
]> {
  if (!input || typeof input !== 'object') throw schemaMismatch()
  assertBoundedText(input.workspaceId, MAX_LABEL_BYTES_V1)
  assertCredentialId(input.providerId)
  assertBoundedText(input.displayLabel, MAX_LABEL_BYTES_V1)
  assertBoundedText(input.credentialType, 64)
  assertPositiveSafeInteger(input.credentialSchemaVersion)
  assertPositiveSafeInteger(input.dekGeneration)
  assertBoundedText(input.actorId, MAX_LABEL_BYTES_V1)
  assertBoundedText(input.requestId, MAX_LABEL_BYTES_V1)
  if (
    !input.fields
    || typeof input.fields.entries !== 'function'
  ) {
    throw schemaMismatch()
  }
  const fields = [...input.fields.entries()]
  if (fields.length === 0 || fields.length > MAX_CREDENTIAL_FIELDS_V1) {
    throw schemaMismatch()
  }
  const seen = new Set<string>()
  for (const [fieldId, value] of fields) {
    assertCredentialId(fieldId)
    if (
      seen.has(fieldId)
      || !(value instanceof Uint8Array)
      || value.byteLength > MAX_CREDENTIAL_FIELD_BYTES_V1
    ) {
      throw schemaMismatch()
    }
    seen.add(fieldId)
  }
  if (input.maskFieldId !== undefined && !seen.has(input.maskFieldId)) {
    throw schemaMismatch()
  }
  return fields
}

function credentialAadId(providerId: string): string {
  // One credential exists per (workspace, provider), so this deterministic ID is
  // the logical credential identity and cannot drift from the primary key.
  return `workspace-provider-credential.${providerId}`
}

function maskingMetadata(value: Uint8Array): string {
  if (value.byteLength < MIN_SAFE_MASK_BYTES_V1) return 'configured'
  const suffix = value.subarray(value.byteLength - 4)
  if (suffix.some((byte) => byte < 0x21 || byte > 0x7e)) return 'configured'
  return String.fromCharCode(...suffix)
}

function stateError(state: string): CredentialResolutionError | undefined {
  if (state === 'active') return undefined
  if (state === 'disabled') {
    return new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.DISABLED,
      'Credential is disabled',
    )
  }
  if (state === 'revoked') {
    return new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.REVOKED,
      'Credential is revoked',
    )
  }
  if (state === 'intentionally_absent' || state === 'instance_fallback_enabled') {
    return new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
      'Credential is not configured',
    )
  }
  return unreadable()
}

/** Dedicated unlogged Postgres connection for secret-bearing vault queries. */
export class PostgresCredentialVaultStore implements CredentialStoreBackendV1 {
  private readonly sqlClient: postgres.Sql
  private readonly db: ReturnType<typeof drizzle>
  private readonly kekProvider: WorkspaceKekProviderV1
  private closed = false

  constructor(options: PostgresCredentialVaultStoreOptionsV1) {
    if (
      !options
      || typeof options.databaseUrl !== 'string'
      || options.databaseUrl.length === 0
      || !Number.isSafeInteger(options.maxConnections ?? 4)
      || (options.maxConnections ?? 4) <= 0
    ) {
      throw schemaMismatch()
    }
    this.sqlClient = postgres(options.databaseUrl, {
      max: options.maxConnections ?? 4,
      idle_timeout: 20,
      connect_timeout: 10,
      debug: false,
    })
    this.db = drizzle(this.sqlClient, { logger: false })
    this.kekProvider = createWorkspaceKekProviderSelectorV1(options.kekProvider)
  }

  async putCredential(input: PutCredentialInputV1): Promise<PutCredentialResultV1> {
    if (this.closed) throw backendUnavailable()
    const fields = validatePutInput(input)
    try {
      return await this.db.transaction(async (tx) => {
        const lockedWorkspace = await tx.execute(drizzleSql`
          SELECT id
          FROM workspaces
          WHERE id = ${input.workspaceId}
          FOR UPDATE
        `)
        if (lockedWorkspace.length !== 1) throw schemaMismatch()

        const existingCredentials = await tx
          .select({
            activeCredentialVersion: workspaceProviderCredentials.activeCredentialVersion,
          })
          .from(workspaceProviderCredentials)
          .where(and(
            eq(workspaceProviderCredentials.workspaceId, input.workspaceId),
            eq(workspaceProviderCredentials.providerId, input.providerId),
          ))
          .limit(1)
        const credentialVersion =
          (existingCredentials[0]?.activeCredentialVersion ?? 0) + 1
        assertPositiveSafeInteger(credentialVersion)

        const keyRows = await tx
          .select({
            workspaceId: workspaceCredentialKeys.workspaceId,
            dekGeneration: workspaceCredentialKeys.dekGeneration,
            kekProviderId: workspaceCredentialKeys.kekProviderId,
            keyRef: workspaceCredentialKeys.keyRef,
            keyVersion: workspaceCredentialKeys.keyVersion,
            wrapperFormat: workspaceCredentialKeys.wrapperFormat,
            wrappedPayload: workspaceCredentialKeys.wrappedPayload,
            wrapperNonce: workspaceCredentialKeys.wrapperNonce,
            wrapperAuthTag: workspaceCredentialKeys.wrapperAuthTag,
            wrapperAadContext: workspaceCredentialKeys.wrapperAadContext,
            state: workspaceCredentialKeys.state,
          })
          .from(workspaceCredentialKeys)
          .where(and(
            eq(workspaceCredentialKeys.workspaceId, input.workspaceId),
            eq(workspaceCredentialKeys.dekGeneration, input.dekGeneration),
          ))
          .limit(1)

        const keyContext = {
          workspaceId: input.workspaceId,
          dekGeneration: input.dekGeneration,
          requestId: input.requestId,
        }
        let plaintextDek: Uint8Array
        let wrappedDek: WrappedWorkspaceDekV1
        if (keyRows[0]) {
          if (keyRows[0].state !== 'active') throw unreadable()
          wrappedDek = deserializeCredentialWrappedDekV1(keyRows[0])
          plaintextDek = await this.kekProvider.unwrapDataKey(keyContext, wrappedDek)
        } else {
          const generated = await this.kekProvider.generateDataKey(keyContext)
          plaintextDek = generated.plaintextDek
          wrappedDek = generated.wrappedDek
          try {
            const serialized = serializeCredentialWrappedDekV1(wrappedDek)
            await tx.insert(workspaceCredentialKeys).values({
              workspaceId: input.workspaceId,
              dekGeneration: input.dekGeneration,
              ...serialized,
              state: 'active',
            })
          } catch (error) {
            plaintextDek.fill(0)
            throw error
          }
        }

        try {
          const envelopes = fields.map(([fieldId, value]) => ({
            fieldId,
            envelope: encryptField(value, plaintextDek, wrappedDek, {
              workspaceId: input.workspaceId,
              credentialId: credentialAadId(input.providerId),
              providerId: input.providerId,
              fieldId,
              credentialVersion,
              dekGeneration: input.dekGeneration,
            }),
          }))
          const maskFieldId = input.maskFieldId ?? fields[0][0]
          const maskValue = fields.find(([fieldId]) => fieldId === maskFieldId)?.[1]
          if (!maskValue) throw schemaMismatch()
          const maskedLastFourSuffix = maskingMetadata(maskValue)

          await tx
            .insert(workspaceProviderCredentials)
            .values({
              workspaceId: input.workspaceId,
              providerId: input.providerId,
              displayLabel: input.displayLabel,
              credentialType: input.credentialType,
              credentialSchemaVersion: input.credentialSchemaVersion,
              state: 'active',
              activeCredentialVersion: credentialVersion,
              dekGeneration: input.dekGeneration,
              maskedLastFourSuffix,
              createdByActorId: input.actorId,
              updatedByActorId: input.actorId,
            })
            .onConflictDoUpdate({
              target: [
                workspaceProviderCredentials.workspaceId,
                workspaceProviderCredentials.providerId,
              ],
              set: {
                displayLabel: input.displayLabel,
                credentialType: input.credentialType,
                credentialSchemaVersion: input.credentialSchemaVersion,
                state: 'active',
                activeCredentialVersion: credentialVersion,
                dekGeneration: input.dekGeneration,
                maskedLastFourSuffix,
                updatedByActorId: input.actorId,
                updatedAt: new Date(),
              },
            })

          await tx.insert(workspaceProviderCredentialFields).values(
            envelopes.map(({ fieldId, envelope }) => ({
              workspaceId: input.workspaceId,
              providerId: input.providerId,
              credentialVersion,
              fieldId,
              envelopeVersion: envelope.envelopeVersion,
              ciphertext: envelope.ciphertext,
              nonce: envelope.nonce,
              authTag: envelope.authTag,
              aadContext: envelope.aadContext,
              dekGeneration: input.dekGeneration,
            })),
          )
          return {
            credentialVersion,
            dekGeneration: input.dekGeneration,
            maskedLastFourSuffix,
          }
        } finally {
          plaintextDek.fill(0)
        }
      })
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw backendUnavailable()
    }
  }

  async read(
    workspaceId: string,
    providerId: ProviderId,
    allowedFieldIds: readonly CredentialFieldId[],
  ): Promise<ResolvedCredentialMaterialV1 & { credentialVersion: number }> {
    if (this.closed) throw backendUnavailable()
    assertBoundedText(workspaceId, MAX_LABEL_BYTES_V1)
    assertCredentialId(providerId)
    if (
      !Array.isArray(allowedFieldIds)
      || allowedFieldIds.length > MAX_CREDENTIAL_FIELDS_V1
    ) {
      throw schemaMismatch()
    }
    const uniqueFieldIds = new Set<string>()
    for (const fieldId of allowedFieldIds) {
      assertCredentialId(fieldId)
      if (uniqueFieldIds.has(fieldId)) throw schemaMismatch()
      uniqueFieldIds.add(fieldId)
    }

    try {
      const credentialRows = await this.db
        .select({
          state: workspaceProviderCredentials.state,
          activeCredentialVersion: workspaceProviderCredentials.activeCredentialVersion,
          dekGeneration: workspaceProviderCredentials.dekGeneration,
        })
        .from(workspaceProviderCredentials)
        .where(and(
          eq(workspaceProviderCredentials.workspaceId, workspaceId),
          eq(workspaceProviderCredentials.providerId, providerId),
        ))
        .limit(1)
      const credential = credentialRows[0]
      if (!credential) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
          'Credential is not configured',
        )
      }
      const invalidState = stateError(credential.state)
      if (invalidState) throw invalidState
      if (allowedFieldIds.length === 0) {
        return {
          kind: 'field-set',
          fields: new Map(),
          credentialVersion: credential.activeCredentialVersion,
        }
      }

      const fieldRows = await this.db
        .select({
          fieldId: workspaceProviderCredentialFields.fieldId,
          envelopeVersion: workspaceProviderCredentialFields.envelopeVersion,
          ciphertext: workspaceProviderCredentialFields.ciphertext,
          nonce: workspaceProviderCredentialFields.nonce,
          authTag: workspaceProviderCredentialFields.authTag,
          aadContext: workspaceProviderCredentialFields.aadContext,
          dekGeneration: workspaceProviderCredentialFields.dekGeneration,
        })
        .from(workspaceProviderCredentialFields)
        .where(and(
          eq(workspaceProviderCredentialFields.workspaceId, workspaceId),
          eq(workspaceProviderCredentialFields.providerId, providerId),
          eq(
            workspaceProviderCredentialFields.credentialVersion,
            credential.activeCredentialVersion,
          ),
          inArray(workspaceProviderCredentialFields.fieldId, [...uniqueFieldIds]),
        ))
      if (
        fieldRows.length !== uniqueFieldIds.size
        || fieldRows.some((row) => row.dekGeneration !== credential.dekGeneration)
      ) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
          'Required credential material is not configured',
        )
      }

      const keyRows = await this.db
        .select({
          workspaceId: workspaceCredentialKeys.workspaceId,
          dekGeneration: workspaceCredentialKeys.dekGeneration,
          kekProviderId: workspaceCredentialKeys.kekProviderId,
          keyRef: workspaceCredentialKeys.keyRef,
          keyVersion: workspaceCredentialKeys.keyVersion,
          wrapperFormat: workspaceCredentialKeys.wrapperFormat,
          wrappedPayload: workspaceCredentialKeys.wrappedPayload,
          wrapperNonce: workspaceCredentialKeys.wrapperNonce,
          wrapperAuthTag: workspaceCredentialKeys.wrapperAuthTag,
          wrapperAadContext: workspaceCredentialKeys.wrapperAadContext,
          state: workspaceCredentialKeys.state,
        })
        .from(workspaceCredentialKeys)
        .where(and(
          eq(workspaceCredentialKeys.workspaceId, workspaceId),
          eq(workspaceCredentialKeys.dekGeneration, credential.dekGeneration),
        ))
        .limit(1)
      const keyRow = keyRows[0]
      if (!keyRow || keyRow.state !== 'active') throw unreadable()
      const wrappedDek = deserializeCredentialWrappedDekV1(keyRow)
      const plaintextDek = await this.kekProvider.unwrapDataKey({
        workspaceId,
        dekGeneration: credential.dekGeneration,
        requestId: randomUUID(),
      }, wrappedDek)
      const fields = new Map<CredentialFieldId, Uint8Array>()
      try {
        for (const fieldId of allowedFieldIds) {
          const row = fieldRows.find((candidate) => candidate.fieldId === fieldId)
          if (!row || row.envelopeVersion !== CREDENTIAL_ENVELOPE_VERSION) {
            throw unreadable()
          }
          const envelope: CredentialEnvelopeV1 = {
            envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
            wrappedDek,
            ciphertext: row.ciphertext,
            nonce: row.nonce,
            authTag: row.authTag,
            aadContext: row.aadContext,
          }
          fields.set(fieldId, decryptField(envelope, plaintextDek, {
            workspaceId,
            credentialId: credentialAadId(providerId),
            providerId,
            fieldId,
            credentialVersion: credential.activeCredentialVersion,
            dekGeneration: credential.dekGeneration,
          }))
        }
        return {
          kind: 'field-set',
          fields,
          credentialVersion: credential.activeCredentialVersion,
        }
      } catch (error) {
        for (const value of fields.values()) value.fill(0)
        throw error
      } finally {
        plaintextDek.fill(0)
      }
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw backendUnavailable()
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.allSettled([
      this.kekProvider.close?.() ?? Promise.resolve(),
      this.sqlClient.end(),
    ])
  }
}
