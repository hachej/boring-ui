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
  rotateWorkspaceDek(workspaceId: string): Promise<number>
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

  async function requireNotShredded(workspaceId: string): Promise<void> {
    if (await persistence.isWorkspaceCryptoShredded(workspaceId)) {
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
      await requireNotShredded(workspaceId)
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
      await requireReady()
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
          const dekGeneration = rotation?.targetGeneration
            ?? existing?.dekGeneration
            ?? anchorState?.dekGeneration
            ?? 1
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
          const record: StoredCredentialRecordV1 = Object.freeze({
            credentialId: existing?.credentialId ?? randomUUID(),
            credentialVersion: expectedCredentialVersion + 1,
            dekGeneration: rotation?.targetGeneration
              ?? existing?.dekGeneration
              ?? anchorState?.dekGeneration
              ?? 1,
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
      const metadata = await persistence.getCredentialMetadata(workspaceId, providerId)
      await requireCurrentMetadata(workspaceId, providerId, metadata)
      return metadata
    },

    async listCredentialMetadata(workspaceId: string) {
      assertWorkspaceId(workspaceId)
      const listed = await persistence.listCredentialMetadata(workspaceId)
      const anchored = await versionAnchor.read(workspaceId)
      const providers = new Set(listed.map(({ providerId }) => providerId))
      if (Object.keys(anchored?.credentialVersions ?? {}).some((providerId) => !providers.has(providerId as ProviderId))) {
        unreadable('Credential metadata failed rollback verification')
      }
      for (const metadata of listed) {
        await requireCurrentMetadata(workspaceId, metadata.providerId, metadata)
      }
      return listed
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
        if (await locked.isWorkspaceCryptoShredded(workspaceId)) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        const wrapped = await requireWrappedDek(workspaceId, dekGeneration, locked)
        const rewrapped = await rewrapDataKey(
          context(workspaceId, dekGeneration),
          wrapped,
        )
        await locked.putWrappedDek(workspaceId, dekGeneration, rewrapped)
      })
    },

    async rotateWorkspaceDek(workspaceId: string): Promise<number> {
      assertWorkspaceId(workspaceId)
      await requireNotShredded(workspaceId)
      await requireReady()

      return persistence.withWorkspaceLock(workspaceId, async (locked) =>
        versionAnchor.withDekGenerationMutation(workspaceId, async (anchorState) => {
        if (await locked.isWorkspaceCryptoShredded(workspaceId)) {
          unreadable('Workspace credential material was crypto-shredded')
        }
      let rotation = await locked.getDekRotationState(workspaceId)
      if (!rotation) {
        const records = await locked.listCredentialRecords(workspaceId)
        if (records.length === 0) notConfigured('Credential material is not configured')
        const generations = new Set(records.map(({ record }) => record.dekGeneration))
        if (generations.size !== 1) {
          unreadable('Workspace credential DEK generations are inconsistent')
        }
        const sourceGeneration = records[0]!.record.dekGeneration
        const targetGeneration = sourceGeneration + 1
        if (!Number.isSafeInteger(targetGeneration)) {
          unreadable('Workspace credential DEK generation is exhausted')
        }
        const generated = await kmsBackend.generateDataKey(
          context(workspaceId, targetGeneration),
        )
        try {
          await locked.putWrappedDek(
            workspaceId,
            targetGeneration,
            generated.wrappedDek,
          )
        } finally {
          generated.plaintextDek.fill(0)
        }
        rotation = Object.freeze({
          sourceGeneration,
          targetGeneration,
          phase: 'reencrypting' as const,
        })
        await locked.putDekRotationState(workspaceId, rotation)
      }
      if (!anchorState || rotation.sourceGeneration !== anchorState.dekGeneration) {
        unreadable('Workspace credential DEK generation failed rollback verification')
      }

      if (rotation.phase === 'reencrypting') {
        const targetWrapped = await requireWrappedDek(
          workspaceId,
          rotation.targetGeneration,
          locked,
        )
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

        // Verify every live envelope under N+1 before making N undecryptable.
        const migrated = await locked.listCredentialRecords(workspaceId)
        const verifyWrapped = await requireWrappedDek(
          workspaceId,
          rotation.targetGeneration,
          locked,
        )
        let verifyDek: Uint8Array | undefined
        try {
          verifyDek = await kmsBackend.unwrapDataKey(
            context(workspaceId, rotation.targetGeneration),
            verifyWrapped,
          )
          for (const { providerId, record } of migrated) {
            if (record.dekGeneration !== rotation.targetGeneration) {
              unreadable('Workspace credential DEK rotation is incomplete')
            }
            const fields = await locked.listFields(
              workspaceId,
              providerId,
              record.credentialVersion,
            )
            if (record.materialKind === 'field-set' && fields.size === 0) {
              unreadable('Current credential field envelopes are missing')
            }
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
                  dekGeneration: rotation.targetGeneration,
                },
              })
              plaintext.fill(0)
            }
          }
        } finally {
          verifyDek?.fill(0)
        }
        rotation = Object.freeze({ ...rotation, phase: 'verified' as const })
        await locked.putDekRotationState(workspaceId, rotation)
      }

      await locked.deleteWrappedDek(workspaceId, rotation.sourceGeneration)
      await locked.clearDekRotationState(workspaceId)
        return {
          nextDekGeneration: rotation.targetGeneration,
          result: rotation.targetGeneration,
        }
      }))
    },

    async cryptoShredWorkspace(workspaceId: string): Promise<void> {
      assertWorkspaceId(workspaceId)
      await persistence.withWorkspaceLock(workspaceId, async (locked) => {
        await locked.cryptoShredWorkspace(workspaceId, new Date().toISOString())
      })
    },
  })
}

export function createVaultCredentialStoreBackendV1(
  options: VaultCredentialStoreOptionsV1,
): VaultCredentialStoreBackendV1 {
  return createVaultCredentialStoreBackendInternalV1(options)
}
