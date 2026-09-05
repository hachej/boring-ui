import { randomUUID } from 'node:crypto'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type {
  CredentialFieldId,
  ProviderId,
  ResolvedCredentialMaterialV1,
  WorkspaceKekContextV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import type { CredentialStoreBackendV1 } from '../hostResolver'
import {
  decryptCredentialFieldV1,
  encryptCredentialFieldV1,
} from './envelopeCrypto'
import type {
  CredentialLifecycleStateV1,
  CredentialVaultPersistenceV1,
  StoredCredentialMetadataV1,
  StoredCredentialRecordV1,
} from './persistence'
import type { WorkspaceCredentialVersionAnchorV1 } from './versionAnchor'

/**
 * Composes a `WorkspaceKekProviderV1` (KmsBackend) with AAD-bound AES-256-GCM
 * field crypto and an injectable persistence port into the
 * `CredentialStoreBackendV1` that `createHostSideCredentialResolverV1` already
 * consumes. The resolver contract is unchanged.
 *
 * Fail-closed rules: an unready backend, an unknown record, a wrong/absent
 * KEK, or any tampered ciphertext/nonce/tag/AAD component throws a stable
 * `CredentialResolutionError`. Nothing here ever returns "absent" in place of
 * an authentication failure, and nothing ever falls back to another backend or
 * to plaintext. Plaintext DEKs and field values are overwritten in `finally` on
 * a best-effort basis (Node/V8 cannot guarantee erasure).
 */

export interface VaultCredentialStoreOptionsV1 {
  readonly kmsBackend: WorkspaceKekProviderV1
  readonly persistence: CredentialVaultPersistenceV1
  readonly versionAnchor: WorkspaceCredentialVersionAnchorV1
}

export interface WriteCredentialFieldsInputV1 {
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly credentialId?: string
  readonly fields: ReadonlyMap<CredentialFieldId, Uint8Array>
  readonly metadata?: Readonly<{
    displayLabel?: string
    credentialType?: string
    maskedLastFourSuffix?: string
  }>
}

export interface VaultCredentialStoreBackendV1 extends CredentialStoreBackendV1 {
  /** Cross-process workspace serialization for Pi CredentialStore.modify(). */
  withWorkspaceLock<T>(
    workspaceId: string,
    mutate: (locked: VaultCredentialStoreBackendV1) => Promise<T>,
  ): Promise<T>
  /**
   * Writes (or rotates to) a new credential version for a workspace/provider.
   * Every write mints a fresh credential version; nonces are never reused.
   */
  writeCredentialFields(
    input: WriteCredentialFieldsInputV1,
  ): Promise<StoredCredentialRecordV1>
  /** Marks a workspace/provider credential as deliberately field-less. */
  writeAbsentCredential(
    workspaceId: string,
    providerId: ProviderId,
  ): Promise<StoredCredentialRecordV1>
  getCredentialMetadata(
    workspaceId: string,
    providerId: ProviderId,
  ): Promise<StoredCredentialMetadataV1 | undefined>
  listCredentialMetadata(workspaceId: string): Promise<readonly StoredCredentialMetadataV1[]>
  setCredentialLifecycleState(
    workspaceId: string,
    providerId: ProviderId,
    state: CredentialLifecycleStateV1,
  ): Promise<StoredCredentialMetadataV1>
  /** Rotates the KEK wrapping for one workspace DEK generation in place. */
  rewrapWorkspaceDek(workspaceId: string, dekGeneration: number): Promise<void>
  /** Re-encrypts all live workspace credentials under a fresh DEK generation. */
  rotateWorkspaceDek(workspaceId: string, operationId: string): Promise<number>
  /** Irreversibly destroys workspace credential key access and fails closed thereafter. */
  cryptoShredWorkspace(workspaceId: string): Promise<void>
}

function notConfigured(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    message,
  )
}

function unreadable(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    message,
  )
}

function assertWorkspaceId(workspaceId: unknown): asserts workspaceId is string {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
      'Invalid workspace identifier',
    )
  }
}

function createVaultCredentialStoreBackendInternalV1(
  options: VaultCredentialStoreOptionsV1,
  lockedWorkspaceId?: string,
): VaultCredentialStoreBackendV1 {
  if (
    !options?.kmsBackend
    || options.kmsBackend.contractVersion !== 'boring.workspace-kek-provider.v1'
    || !options.persistence
    || !options.versionAnchor
  ) {
    notConfigured('Credential vault backend is misconfigured')
  }
  const { kmsBackend, persistence, versionAnchor } = options

  async function requireNotShredded(
    workspaceId: string,
    store: CredentialVaultPersistenceV1 = persistence,
  ): Promise<void> {
    const anchored = await versionAnchor.read(workspaceId)
    if (
      (anchored?.cryptoShredGeneration ?? 0) > 0
      || await store.isWorkspaceCryptoShredded(workspaceId)
    ) {
      unreadable('Workspace credential material was crypto-shredded')
    }
  }

  async function requireReady(): Promise<void> {
    let readiness: Awaited<ReturnType<WorkspaceKekProviderV1['readiness']>>
    try {
      readiness = await kmsBackend.readiness()
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        'Credential key backend is unavailable',
        { retryable: true },
      )
    }
    if (!readiness?.ready) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        `Credential key backend is not ready (${readiness?.reasonCode ?? 'unknown'})`,
        { retryable: true },
      )
    }
  }

  function context(
    workspaceId: string,
    dekGeneration: number,
  ): WorkspaceKekContextV1 {
    return { workspaceId, dekGeneration, requestId: randomUUID() }
  }

  async function requireCurrentVersion(
    workspaceId: string,
    providerId: ProviderId,
    record: StoredCredentialRecordV1,
  ): Promise<void> {
    const anchored = await versionAnchor.read(workspaceId)
    if (
      anchored?.credentialVersions[providerId] !== record.credentialVersion
      || anchored.credentialMaterialKinds[providerId] !== record.materialKind
      || anchored.dekGeneration !== record.dekGeneration
    ) {
      unreadable('Credential current state failed rollback verification')
    }
  }

  async function requireCurrentMetadata(
    workspaceId: string,
    providerId: ProviderId,
    metadata: StoredCredentialMetadataV1 | undefined,
  ): Promise<void> {
    const anchored = await versionAnchor.read(workspaceId)
    const anchoredVersion = anchored?.credentialVersions[providerId]
    if (!metadata) {
      if (anchoredVersion !== undefined) {
        unreadable('Credential metadata failed rollback verification')
      }
      return
    }
    if (
      anchoredVersion !== metadata.credentialVersion
      || anchored?.credentialLifecycleStates[providerId] !== metadata.state
      || anchored.credentialTypes[providerId] !== metadata.credentialType
    ) unreadable('Credential metadata failed rollback verification')
  }

  async function requireWrappedDek(
    workspaceId: string,
    dekGeneration: number,
    store: CredentialVaultPersistenceV1 = persistence,
  ): Promise<WrappedWorkspaceDekV1> {
    const wrapped = await store.getWrappedDek(workspaceId, dekGeneration)
    if (!wrapped) {
      // A record exists but its key generation does not: fail closed, do not
      // silently mint a new DEK and lose access to the existing ciphertext.
      unreadable('Workspace credential key generation is missing')
    }
    return wrapped
  }

  return Object.freeze({
    async withWorkspaceLock<T>(
      workspaceId: string,
      mutate: (locked: VaultCredentialStoreBackendV1) => Promise<T>,
    ): Promise<T> {
      assertWorkspaceId(workspaceId)
      if (lockedWorkspaceId === workspaceId) return mutate(this)
      return persistence.withWorkspaceLock(workspaceId, (lockedPersistence) =>
        mutate(createVaultCredentialStoreBackendInternalV1({
          kmsBackend,
          versionAnchor,
          persistence: lockedPersistence,
        }, workspaceId)))
    },

    async read(
      workspaceId: string,
      providerId: ProviderId,
      allowedFieldIds: readonly CredentialFieldId[],
    ): Promise<ResolvedCredentialMaterialV1 & { credentialVersion: number }> {
      assertWorkspaceId(workspaceId)
      if (lockedWorkspaceId !== workspaceId) {
        return this.withWorkspaceLock(workspaceId, (locked) =>
          locked.read(workspaceId, providerId, allowedFieldIds))
      }
      await requireNotShredded(workspaceId)
      // The version anchor is authenticated with the same KEK. Check backend
      // readiness first so an unavailable key source keeps its retryable,
      // operator-actionable code instead of being misclassified as corruption.
      await requireReady()
      const metadata = await persistence.getCredentialMetadata(workspaceId, providerId)
      await requireCurrentMetadata(workspaceId, providerId, metadata)
      if (metadata?.state === 'disabled') {
        throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.DISABLED, 'Credential is disabled')
      }
      if (
        metadata?.state === 'revoked'
        || (metadata?.state === 'intentionally_absent' && allowedFieldIds.length > 0)
      ) {
        throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.REVOKED, 'Credential is revoked')
      }
      if (metadata?.state === 'needs_reauth') {
        notConfigured('Credential requires reauthentication')
      }
      if (metadata?.state === 'instance_fallback_enabled') {
        notConfigured('Workspace credential uses instance fallback')
      }
      const record = await persistence.getCredentialRecord(workspaceId, providerId)
      if (!record) {
        const anchoredVersion = (await versionAnchor.read(workspaceId))
          ?.credentialVersions[providerId]
        if (anchoredVersion !== undefined) {
          unreadable('Credential current version failed rollback verification')
        }
        notConfigured('Credential material is not configured')
      }
      await requireCurrentVersion(workspaceId, providerId, record)
      if (record.materialKind === 'none') {
        if (allowedFieldIds.length !== 0) {
          notConfigured('Credential material is not configured')
        }
        return { kind: 'none', credentialVersion: record.credentialVersion }
      }
      if (allowedFieldIds.length === 0) {
        return {
          kind: 'field-set',
          fields: new Map(),
          credentialVersion: record.credentialVersion,
        }
      }

      const wrappedDek = await requireWrappedDek(workspaceId, record.dekGeneration)
      let plaintextDek: Uint8Array | undefined
      const fields = new Map<CredentialFieldId, Uint8Array>()
      try {
        plaintextDek = await kmsBackend.unwrapDataKey(
          context(workspaceId, record.dekGeneration),
          wrappedDek,
        )
        for (const fieldId of allowedFieldIds) {
          const envelope = await persistence.getField({
            workspaceId,
            providerId,
            credentialVersion: record.credentialVersion,
            dekGeneration: record.dekGeneration,
            fieldId,
          })
          if (!envelope) {
            // The anchored record asserts that this version is current. A
            // missing current envelope is storage corruption/deletion, not an
            // authenticated "not configured" state.
            unreadable('Current credential field envelope is missing')
          }
          const plaintext = decryptCredentialFieldV1({
            plaintextDek,
            envelope,
            aadContext: {
              workspaceId,
              credentialId: record.credentialId,
              providerId,
              fieldId,
              credentialVersion: record.credentialVersion,
              dekGeneration: record.dekGeneration,
            },
          })
          try {
            fields.set(fieldId, new Uint8Array(plaintext))
          } finally {
            plaintext.fill(0)
          }
        }
      } catch (error) {
        for (const value of fields.values()) value.fill(0)
        fields.clear()
        throw error
      } finally {
        plaintextDek?.fill(0)
      }
      return {
        kind: 'field-set',
        fields,
        credentialVersion: record.credentialVersion,
      }
    },

    async writeCredentialFields(
      input: WriteCredentialFieldsInputV1,
    ): Promise<StoredCredentialRecordV1> {
      assertWorkspaceId(input?.workspaceId)
      if (lockedWorkspaceId !== input.workspaceId) {
        return this.withWorkspaceLock(input.workspaceId, (locked) =>
          locked.writeCredentialFields(input))
      }
      if (input.fields.size === 0) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
          'Credential field set must not be empty',
        )
      }
      await requireNotShredded(input.workspaceId)
      await requireReady()
      const { workspaceId, providerId } = input
      return versionAnchor.withMutation(
        workspaceId,
        providerId,
        async (anchorState) => {
          const existing = await persistence.getCredentialRecord(workspaceId, providerId)
          const anchoredVersion = anchorState?.credentialVersions[providerId]
          const anchoredMaterialKind = anchorState?.credentialMaterialKinds[providerId]
          if (
            (existing && (
              anchoredVersion !== existing.credentialVersion
              || anchoredMaterialKind !== existing.materialKind
            ))
            || (!existing && anchoredVersion !== undefined)
          ) unreadable('Credential current state failed rollback verification')
          const expectedCredentialVersion = existing?.credentialVersion ?? 0
          const credentialVersion = expectedCredentialVersion + 1
          const credentialId =
            input.credentialId ?? existing?.credentialId ?? randomUUID()
          const rotation = await persistence.getDekRotationState(workspaceId)
          if (rotation) {
            throw new CredentialResolutionError(
              CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
              'Credential write must retry after DEK rotation',
              { retryable: true },
            )
          }
          const dekGeneration = existing?.dekGeneration ?? anchorState?.dekGeneration ?? 1
          const encryptedFields = new Map<string, ReturnType<typeof encryptCredentialFieldV1>>()

          let plaintextDek: Uint8Array | undefined
          try {
            const storedDek = await persistence.getWrappedDek(workspaceId, dekGeneration)
            if (storedDek) {
              plaintextDek = await kmsBackend.unwrapDataKey(
                context(workspaceId, dekGeneration),
                storedDek,
              )
            } else {
              const generated = await kmsBackend.generateDataKey(
                context(workspaceId, dekGeneration),
              )
              plaintextDek = generated.plaintextDek
              await persistence.putWrappedDek(
                workspaceId,
                dekGeneration,
                generated.wrappedDek,
              )
            }
            for (const [fieldId, plaintext] of input.fields) {
              encryptedFields.set(fieldId, encryptCredentialFieldV1({
                plaintextDek,
                plaintext,
                aadContext: {
                  workspaceId,
                  credentialId,
                  providerId,
                  fieldId,
                  credentialVersion,
                  dekGeneration,
                },
              }))
            }
          } finally {
            plaintextDek?.fill(0)
          }

          const record: StoredCredentialRecordV1 = Object.freeze({
            credentialId,
            credentialVersion,
            dekGeneration,
            materialKind: 'field-set',
          })
          await persistence.commitCredentialVersion({
            workspaceId,
            providerId,
            expectedCredentialVersion,
            record,
            fields: encryptedFields,
            supersededFieldsTombstone: existing ? {
              deletedAt: new Date().toISOString(),
              reason: 'superseded-version',
            } : undefined,
          })
          if (input.metadata) {
            await persistence.updateCredentialMetadata(workspaceId, providerId, {
              state: 'active',
              displayLabel: input.metadata.displayLabel,
              credentialType: input.metadata.credentialType,
              maskedLastFourSuffix: input.metadata.maskedLastFourSuffix,
            })
          }
          const storedMetadata = await persistence.getCredentialMetadata(workspaceId, providerId)
          if (!storedMetadata) unreadable('Credential metadata is missing after write')
          return {
            nextCredentialVersion: credentialVersion,
            nextCredentialMaterialKind: record.materialKind,
            nextCredentialFieldIds: [...encryptedFields.keys()],
            nextCredentialLifecycleState: 'active',
            nextCredentialType: storedMetadata.credentialType,
            nextDekGeneration: record.dekGeneration,
            result: record,
          }
        },
      )
    },

    async writeAbsentCredential(
      workspaceId: string,
      providerId: ProviderId,
    ): Promise<StoredCredentialRecordV1> {
      assertWorkspaceId(workspaceId)
      if (lockedWorkspaceId !== workspaceId) {
        return this.withWorkspaceLock(workspaceId, (locked) =>
          locked.writeAbsentCredential(workspaceId, providerId))
      }
      await requireNotShredded(workspaceId)
      await requireReady()
      const written = await versionAnchor.withMutation(
        workspaceId,
        providerId,
        async (anchorState) => {
          const existing = await persistence.getCredentialRecord(workspaceId, providerId)
          const anchoredVersion = anchorState?.credentialVersions[providerId]
          const anchoredMaterialKind = anchorState?.credentialMaterialKinds[providerId]
          if (
            (existing && (
              anchoredVersion !== existing.credentialVersion
              || anchoredMaterialKind !== existing.materialKind
            ))
            || (!existing && anchoredVersion !== undefined)
          ) unreadable('Credential current state failed rollback verification')
          const expectedCredentialVersion = existing?.credentialVersion ?? 0
          const rotation = await persistence.getDekRotationState(workspaceId)
          if (rotation) {
            throw new CredentialResolutionError(
              CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
              'Credential write must retry after DEK rotation',
              { retryable: true },
            )
          }
          const record: StoredCredentialRecordV1 = Object.freeze({
            credentialId: existing?.credentialId ?? randomUUID(),
            credentialVersion: expectedCredentialVersion + 1,
            dekGeneration: existing?.dekGeneration ?? anchorState?.dekGeneration ?? 1,
            materialKind: 'none',
          })
          await persistence.commitCredentialVersion({
            workspaceId,
            providerId,
            expectedCredentialVersion,
            record,
            fields: new Map(),
            supersededFieldsTombstone: existing ? {
              deletedAt: new Date().toISOString(),
              reason: 'credential-tombstone',
            } : undefined,
          })
          const storedMetadata = await persistence.getCredentialMetadata(workspaceId, providerId)
          if (!storedMetadata) unreadable('Credential metadata is missing after delete')
          return {
            nextCredentialVersion: record.credentialVersion,
            nextCredentialMaterialKind: record.materialKind,
            nextCredentialFieldIds: [],
            nextCredentialLifecycleState: 'intentionally_absent',
            nextCredentialType: storedMetadata.credentialType,
            nextDekGeneration: record.dekGeneration,
            result: record,
          }
        },
      )
      await persistence.updateCredentialMetadata(workspaceId, providerId, {
        state: 'intentionally_absent',
        maskedLastFourSuffix: null,
      })
      return written
    },

    async getCredentialMetadata(workspaceId: string, providerId: ProviderId) {
      assertWorkspaceId(workspaceId)
      await requireNotShredded(workspaceId)
      const metadata = await persistence.getCredentialMetadata(workspaceId, providerId)
      await requireCurrentMetadata(workspaceId, providerId, metadata)
      return metadata
    },

    async listCredentialMetadata(workspaceId: string) {
      assertWorkspaceId(workspaceId)
      return versionAnchor.withReadLock(workspaceId, async (readLocked) => {
        const listed = await persistence.listCredentialMetadata(workspaceId)
        const hasArtifacts = listed.length > 0
          || await persistence.hasWorkspaceCredentialArtifacts(workspaceId)
        // A clean deployment has neither persistence artifacts nor an anchor
        // file yet. Permit only that narrow unprovisioned case so the registry
        // can project `not_configured`. A present anchor is always authenticated
        // and still catches deleted/replayed metadata when the list is empty.
        const anchored = await readLocked({ allowUnprovisioned: !hasArtifacts })
        if (
          (anchored?.cryptoShredGeneration ?? 0) > 0
          || await persistence.isWorkspaceCryptoShredded(workspaceId)
        ) unreadable('Workspace credential material was crypto-shredded')
        if (hasArtifacts && !anchored) {
          unreadable('Credential workspace state failed rollback verification')
        }
        const providers = new Set(listed.map(({ providerId }) => providerId))
        if (Object.keys(anchored?.credentialVersions ?? {}).some((providerId) => !providers.has(providerId as ProviderId))) {
          unreadable('Credential metadata failed rollback verification')
        }
        for (const metadata of listed) {
          if (
            anchored?.credentialVersions[metadata.providerId] !== metadata.credentialVersion
            || anchored.credentialLifecycleStates[metadata.providerId] !== metadata.state
            || anchored.credentialTypes[metadata.providerId] !== metadata.credentialType
          ) unreadable('Credential metadata failed rollback verification')
        }
        return listed
      })
    },

    async setCredentialLifecycleState(
      workspaceId: string,
      providerId: ProviderId,
      state: CredentialLifecycleStateV1,
    ) {
      assertWorkspaceId(workspaceId)
      if (lockedWorkspaceId !== workspaceId) {
        return this.withWorkspaceLock(workspaceId, (locked) =>
          locked.setCredentialLifecycleState(workspaceId, providerId, state))
      }
      await requireNotShredded(workspaceId)
      return versionAnchor.withLifecycleMutation(
        workspaceId,
        providerId,
        async (anchorState) => {
          const record = await persistence.getCredentialRecord(workspaceId, providerId)
          const metadata = await persistence.getCredentialMetadata(workspaceId, providerId)
          if (
            !record
            || !metadata
            || anchorState?.credentialVersions[providerId] !== record.credentialVersion
            || anchorState.credentialLifecycleStates[providerId] !== metadata.state
          ) unreadable('Credential lifecycle state failed rollback verification')
          const result = await persistence.updateCredentialMetadata(workspaceId, providerId, { state })
          return { nextCredentialLifecycleState: state, result }
        },
      )
    },

    async rewrapWorkspaceDek(
      workspaceId: string,
      dekGeneration: number,
    ): Promise<void> {
      assertWorkspaceId(workspaceId)
      await requireNotShredded(workspaceId)
      await requireReady()
      const rewrapDataKey = kmsBackend.rewrapDataKey
      if (typeof rewrapDataKey !== 'function') {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
          'Credential key backend does not support rewrap',
        )
      }
      await persistence.withWorkspaceLock(workspaceId, async (locked) => {
        await requireNotShredded(workspaceId, locked)
        const wrapped = await requireWrappedDek(workspaceId, dekGeneration, locked)
        const rewrapped = await rewrapDataKey(
          context(workspaceId, dekGeneration),
          wrapped,
        )
        await locked.putWrappedDek(workspaceId, dekGeneration, rewrapped)
      })
    },

    async rotateWorkspaceDek(workspaceId: string, operationId: string): Promise<number> {
      assertWorkspaceId(workspaceId)
      if (typeof operationId !== 'string' || operationId.length === 0 || operationId.length > 200) {
        throw new CredentialResolutionError(
          CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
          'Credential DEK rotation operation identifier is required',
        )
      }
      await requireNotShredded(workspaceId)
      await requireReady()

      return persistence.withWorkspaceLock(workspaceId, async (locked) => {
        if (await locked.isWorkspaceCryptoShredded(workspaceId)) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        const completed = await locked.getDekRotationReceipt(workspaceId, operationId)
        if (completed) {
          const completedAnchor = await versionAnchor.read(workspaceId)
          const records = await locked.listCredentialRecords(workspaceId)
          const anchoredProviders = completedAnchor
            ? Object.keys(completedAnchor.credentialVersions)
            : []
          if (
            !completedAnchor
            || completedAnchor.dekRotationReceipts[operationId] !== completed.targetGeneration
            || completedAnchor.dekGeneration < completed.targetGeneration
            || records.length !== anchoredProviders.length
            || records.some(({ providerId, record }) => (
              record.dekGeneration !== completedAnchor.dekGeneration
              || record.credentialVersion !== completedAnchor.credentialVersions[providerId]
              || record.materialKind !== completedAnchor.credentialMaterialKinds[providerId]
            ))
            || anchoredProviders.some(
              (providerId) => !records.some((entry) => entry.providerId === providerId),
            )
            || await locked.getWrappedDek(workspaceId, completed.sourceGeneration)
          ) {
            unreadable('Credential DEK rotation receipt failed finalization verification')
          }
          return completed.targetGeneration
        }

        let anchorState = await versionAnchor.read(workspaceId)
        let rotation = await locked.getDekRotationState(workspaceId)
        if (!rotation) {
          const records = await locked.listCredentialRecords(workspaceId)
          if (records.length === 0) notConfigured('Credential material is not configured')
          const generations = new Set(records.map(({ record }) => record.dekGeneration))
          if (generations.size !== 1) {
            unreadable('Workspace credential DEK generations are inconsistent')
          }
          const sourceGeneration = records[0]!.record.dekGeneration
          if (!anchorState || anchorState.dekGeneration !== sourceGeneration) {
            unreadable('Workspace credential DEK generation failed rollback verification')
          }
          const targetGeneration = sourceGeneration + 1
          if (!Number.isSafeInteger(targetGeneration)) {
            unreadable('Workspace credential DEK generation is exhausted')
          }
          rotation = Object.freeze({
            operationId,
            sourceGeneration,
            targetGeneration,
            phase: 'reencrypting' as const,
          })
          // Persist intent before creating N+1 so every later boundary is resumable.
          await locked.putDekRotationState(workspaceId, rotation)
        } else if (rotation.operationId !== operationId) {
          if (rotation.operationId.startsWith('legacy:')) {
            // Pre-state-machine migrations had no caller idempotency key. The
            // first post-upgrade retry durably adopts its key without changing N→N+1.
            rotation = Object.freeze({ ...rotation, operationId })
            await locked.putDekRotationState(workspaceId, rotation)
          } else {
            throw new CredentialResolutionError(
              CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
              'Another credential DEK rotation is already in progress',
              { retryable: true },
            )
          }
        }

        if (
          rotation.targetGeneration !== rotation.sourceGeneration + 1
          || !Number.isSafeInteger(rotation.targetGeneration)
        ) unreadable('Credential DEK rotation generations are not adjacent')

        let targetWrapped = await locked.getWrappedDek(workspaceId, rotation.targetGeneration)
        if (!targetWrapped) {
          if (rotation.phase !== 'reencrypting') {
            unreadable('Workspace credential target key generation is missing')
          }
          const generated = await kmsBackend.generateDataKey(
            context(workspaceId, rotation.targetGeneration),
          )
          try {
            await locked.putWrappedDek(
              workspaceId,
              rotation.targetGeneration,
              generated.wrappedDek,
            )
            targetWrapped = generated.wrappedDek
          } finally {
            generated.plaintextDek.fill(0)
          }
        }

        if (!anchorState) unreadable('Credential DEK generation anchor is missing')
        if (
          anchorState.dekGeneration !== rotation.sourceGeneration
          && anchorState.dekGeneration !== rotation.targetGeneration
        ) {
          unreadable('Workspace credential DEK generation failed rollback verification')
        }

        const targetGeneration = rotation.targetGeneration
        const credentialAnchor = anchorState
        const verifyTargetGeneration = async () => {
          const migrated = await locked.listCredentialRecords(workspaceId)
          const anchoredProviders = Object.keys(credentialAnchor.credentialVersions)
          if (migrated.length !== anchoredProviders.length) {
            unreadable('Workspace credential DEK rotation record set is incomplete')
          }
          const migratedByProvider = new Map(migrated.map((entry) => [entry.providerId, entry.record]))
          for (const providerId of anchoredProviders) {
            const record = migratedByProvider.get(providerId as ProviderId)
            if (
              !record
              || record.credentialVersion !== credentialAnchor.credentialVersions[providerId]
              || record.materialKind !== credentialAnchor.credentialMaterialKinds[providerId]
            ) unreadable('Workspace credential DEK rotation record set failed anchor verification')
          }
          const verifyWrapped = await requireWrappedDek(
            workspaceId,
            targetGeneration,
            locked,
          )
          let verifyDek: Uint8Array | undefined
          try {
            verifyDek = await kmsBackend.unwrapDataKey(
              context(workspaceId, targetGeneration),
              verifyWrapped,
            )
            for (const { providerId, record } of migrated) {
              if (record.dekGeneration !== targetGeneration) {
                unreadable('Workspace credential DEK rotation is incomplete')
              }
              const fields = await locked.listFields(
                workspaceId,
                providerId,
                record.credentialVersion,
              )
              const anchoredFieldIds = credentialAnchor.credentialFieldIds[providerId]
              if (
                !anchoredFieldIds
                || anchoredFieldIds.length !== fields.size
                || anchoredFieldIds.some((fieldId) => !fields.has(fieldId))
              ) unreadable('Workspace credential fields failed anchor verification')
              for (const [fieldId, envelope] of fields) {
                const plaintext = decryptCredentialFieldV1({
                  plaintextDek: verifyDek,
                  envelope,
                  aadContext: {
                    workspaceId,
                    credentialId: record.credentialId,
                    providerId,
                    fieldId,
                    credentialVersion: record.credentialVersion,
                    dekGeneration: targetGeneration,
                  },
                })
                plaintext.fill(0)
              }
            }
          } finally {
            verifyDek?.fill(0)
          }
        }

        if (rotation.phase === 'reencrypting') {
          if (anchorState.dekGeneration !== rotation.sourceGeneration) {
            unreadable('Credential DEK anchor advanced before database verification')
          }
          const records = await locked.listCredentialRecords(workspaceId)
          const sourceRecords = records.filter(
            ({ record }) => record.dekGeneration === rotation!.sourceGeneration,
          )
          const requiresSourceKey = sourceRecords.some(
            ({ record }) => record.materialKind === 'field-set',
          )
          const sourceWrapped = requiresSourceKey
            ? await requireWrappedDek(workspaceId, rotation.sourceGeneration, locked)
            : undefined
          let sourceDek: Uint8Array | undefined
          let targetDek: Uint8Array | undefined
          try {
            if (sourceWrapped) {
              sourceDek = await kmsBackend.unwrapDataKey(
                context(workspaceId, rotation.sourceGeneration),
                sourceWrapped,
              )
            }
            targetDek = await kmsBackend.unwrapDataKey(
              context(workspaceId, rotation.targetGeneration),
              targetWrapped,
            )
            for (const { providerId, record } of sourceRecords) {
              const encryptedFields = new Map<string, ReturnType<typeof encryptCredentialFieldV1>>()
              const storedFields = await locked.listFields(
                workspaceId,
                providerId,
                record.credentialVersion,
              )
              if (record.materialKind === 'field-set' && storedFields.size === 0) {
                unreadable('Current credential field envelopes are missing')
              }
              for (const [fieldId, envelope] of storedFields) {
                if (!sourceDek) unreadable('Workspace credential key generation is missing')
                const plaintext = decryptCredentialFieldV1({
                  plaintextDek: sourceDek,
                  envelope,
                  aadContext: {
                    workspaceId,
                    credentialId: record.credentialId,
                    providerId,
                    fieldId,
                    credentialVersion: record.credentialVersion,
                    dekGeneration: rotation.sourceGeneration,
                  },
                })
                try {
                  encryptedFields.set(fieldId, encryptCredentialFieldV1({
                    plaintextDek: targetDek,
                    plaintext,
                    aadContext: {
                      workspaceId,
                      credentialId: record.credentialId,
                      providerId,
                      fieldId,
                      credentialVersion: record.credentialVersion,
                      dekGeneration: rotation.targetGeneration,
                    },
                  }))
                } finally {
                  plaintext.fill(0)
                }
              }
              await locked.commitDekRotationRecord({
                workspaceId,
                providerId,
                expectedCredentialVersion: record.credentialVersion,
                sourceGeneration: rotation.sourceGeneration,
                targetGeneration: rotation.targetGeneration,
                fields: encryptedFields,
              })
            }
          } finally {
            sourceDek?.fill(0)
            targetDek?.fill(0)
          }

          await verifyTargetGeneration()
          rotation = Object.freeze({ ...rotation, phase: 'verified' as const })
          await locked.putDekRotationState(workspaceId, rotation)
        }

        if (rotation.phase === 'verified') {
          // The marker is database-controlled; authenticate its claim by
          // rechecking every N+1 record/envelope before advancing the anchor.
          await verifyTargetGeneration()
          if (anchorState.dekGeneration === rotation.sourceGeneration) {
            await versionAnchor.withDekGenerationMutation(workspaceId, async (current) => {
              if (!current || current.dekGeneration !== rotation!.sourceGeneration) {
                unreadable('Credential DEK generation anchor changed during rotation')
              }
              return {
                nextDekGeneration: rotation!.targetGeneration,
                nextDekRotationOperationId: rotation!.operationId,
                result: undefined,
              }
            })
            anchorState = await versionAnchor.read(workspaceId)
          }
          if (anchorState?.dekGeneration !== rotation.targetGeneration) {
            unreadable('Credential DEK generation anchor did not advance')
          }
          rotation = Object.freeze({ ...rotation, phase: 'anchor-advanced' as const })
          await locked.putDekRotationState(workspaceId, rotation)
        }

        if (rotation.phase !== 'anchor-advanced') {
          unreadable('Credential DEK rotation finalization state is invalid')
        }
        const finalAnchor = await versionAnchor.read(workspaceId)
        if (
          !finalAnchor
          || finalAnchor.dekGeneration !== rotation.targetGeneration
          || finalAnchor.dekRotationReceipts[rotation.operationId] !== rotation.targetGeneration
        ) unreadable('Credential DEK rotation finalization failed anchor verification')
        await verifyTargetGeneration()
        await locked.finalizeDekRotation(workspaceId, rotation)
        return rotation.targetGeneration
      })
    },

    async cryptoShredWorkspace(workspaceId: string): Promise<void> {
      assertWorkspaceId(workspaceId)
      await persistence.withWorkspaceLock(workspaceId, async (locked) => {
        await versionAnchor.withCryptoShredMutation(workspaceId, async () => {
          await locked.cryptoShredWorkspace(workspaceId, new Date().toISOString())
          return { result: undefined }
        })
      })
    },
  })
}

export function createVaultCredentialStoreBackendV1(
  options: VaultCredentialStoreOptionsV1,
): VaultCredentialStoreBackendV1 {
  return createVaultCredentialStoreBackendInternalV1(options)
}
