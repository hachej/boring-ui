import {
  createHmac,
  hkdfSync,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import lockfile from 'proper-lockfile'
import { dirname } from 'node:path'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type { CredentialLifecycleStateV1, ProviderId } from '../../../shared/credentials'
import type { CredentialMaterialKindV1 } from './persistence'

const ANCHOR_FORMAT_V2 = 'boring.credential-version-anchor.v2' as const
const ANCHOR_MAC_INFO_V1 = 'boring.credential-version-anchor.mac.v1'

export interface WorkspaceCredentialVersionStateV1 {
  readonly counter: number
  /** Monotonic irreversible fence; any positive value means the workspace was shredded. */
  readonly cryptoShredGeneration: number
  /** Monotonic workspace-wide fence for replayed wrapped DEKs and records. */
  readonly dekGeneration: number
  /** Authenticated idempotency receipts for completed DEK rotations. */
  readonly dekRotationReceipts: Readonly<Record<string, number>>
  readonly credentialVersions: Readonly<Record<string, number>>
  readonly credentialMaterialKinds: Readonly<Record<string, CredentialMaterialKindV1>>
  readonly credentialFieldIds: Readonly<Record<string, readonly string[]>>
  readonly credentialLifecycleStates: Readonly<Record<string, CredentialLifecycleStateV1>>
  readonly credentialTypes: Readonly<Record<string, string>>
}

export interface PendingCredentialVersionMutationV1 {
  readonly operationId: string
  readonly providerId: ProviderId
  readonly expectedStateDigest: string
  readonly nextStateDigest: string
  readonly nextCredentialVersion: number
  readonly nextCredentialMaterialKind: CredentialMaterialKindV1
  readonly nextCredentialFieldIds: readonly string[]
  readonly nextCredentialLifecycleState: CredentialLifecycleStateV1
  readonly nextCredentialType: string
  readonly nextDekGeneration: number
}

export interface CredentialVersionMutationStateV1 {
  readonly nextCredentialVersion: number
  readonly nextCredentialMaterialKind: CredentialMaterialKindV1
  readonly nextCredentialFieldIds: readonly string[]
  readonly nextCredentialLifecycleState: CredentialLifecycleStateV1
  readonly nextCredentialType: string
  readonly nextDekGeneration: number
}

/**
 * Backward-compatible V1 mutation result. Built-in durable anchors additionally
 * accept the recoverable prepare/commit variant without breaking custom V1 callers.
 */
export type CredentialVersionMutationResultV1<T> = CredentialVersionMutationStateV1 & (
  | { readonly result: T }
  | {
      readonly expectedStateDigest: string
      readonly nextStateDigest: string
      readonly commit: () => Promise<T>
    }
)

export interface DekGenerationMutationResultV1<T> {
  readonly nextDekGeneration: number
  readonly nextDekRotationOperationId: string
  readonly result: T
}

export interface CredentialLifecycleMutationResultV1<T> {
  readonly nextCredentialLifecycleState: CredentialLifecycleStateV1
  readonly result: T
}

export interface CryptoShredMutationResultV1<T> {
  readonly result: T
}

export interface CredentialVersionAnchorReadOptionsV1 {
  /**
   * A provider-list probe may treat a never-provisioned anchor file as empty
   * only when persistence has no credential metadata. Existing malformed or
   * unauthenticated anchor files still fail closed.
   */
  readonly allowUnprovisioned?: boolean
}

export type CredentialVersionAnchorReaderV1 = (
  options?: CredentialVersionAnchorReadOptionsV1,
) => Promise<WorkspaceCredentialVersionStateV1 | undefined>

export interface WorkspaceCredentialVersionAnchorV1 {
  read(
    workspaceId: string,
    options?: CredentialVersionAnchorReadOptionsV1,
  ): Promise<WorkspaceCredentialVersionStateV1 | undefined>
  /** Returns the authenticated recovery intent, if a prior mutation was interrupted. */
  readPendingMutation?(
    workspaceId: string,
    options?: CredentialVersionAnchorReadOptionsV1,
  ): Promise<PendingCredentialVersionMutationV1 | undefined>
  /**
   * Resolves an authenticated pending intent from a digest of the durable DB state.
   * Only the exact committed state advances automatically. The exact pre-commit
   * state remains fail-stopped because a DB replay after commit is indistinguishable.
   */
  recoverPendingMutation?(workspaceId: string, durableStateDigest: string): Promise<void>
  /** Serializes a persistence inspection with anchor mutations. */
  withReadLock<T>(
    workspaceId: string,
    inspect: (readLocked: CredentialVersionAnchorReaderV1) => Promise<T>,
  ): Promise<T>
  /**
   * Holds the external workspace mutation lock through a write-ahead,
   * KEK-authenticated intent, the supplied DB CAS, and anchor finalization.
   * This is a recoverable protocol, not cross-store atomicity: interruption
   * leaves a signed intent. Recovery advances only its exact committed DB
   * digest; the pre-commit digest and every other state remain fail-closed.
   */
  withMutation<T>(
    workspaceId: string,
    providerId: ProviderId,
    mutate: (
      current: WorkspaceCredentialVersionStateV1 | undefined,
    ) => Promise<CredentialVersionMutationResultV1<T>>,
  ): Promise<T>
  /** Authenticates a lifecycle-only state transition without minting a version. */
  withLifecycleMutation<T>(
    workspaceId: string,
    providerId: ProviderId,
    mutate: (
      current: WorkspaceCredentialVersionStateV1 | undefined,
    ) => Promise<CredentialLifecycleMutationResultV1<T>>,
  ): Promise<T>
  /**
   * Irreversibly advances the authenticated external shred fence before
   * destructive persistence finalization. Repeated calls retain the fence and
   * re-run finalization so cleanup is recoverable and idempotent.
   */
  withCryptoShredMutation<T>(
    workspaceId: string,
    mutate: (
      current: WorkspaceCredentialVersionStateV1,
    ) => Promise<CryptoShredMutationResultV1<T>>,
  ): Promise<T>
  /** Advances the authenticated workspace DEK fence exactly one generation. */
  withDekGenerationMutation<T>(
    workspaceId: string,
    mutate: (
      current: WorkspaceCredentialVersionStateV1 | undefined,
    ) => Promise<DekGenerationMutationResultV1<T>>,
  ): Promise<T>
}

/** Recovery-capable authority required by the durable vault backend. */
export interface WorkspaceCredentialVersionAnchorV2 extends WorkspaceCredentialVersionAnchorV1 {
  readPendingMutation(
    workspaceId: string,
    options?: CredentialVersionAnchorReadOptionsV1,
  ): Promise<PendingCredentialVersionMutationV1 | undefined>
  recoverPendingMutation(workspaceId: string, durableStateDigest: string): Promise<void>
}

type MutableAnchorStateV1 = {
  format: typeof ANCHOR_FORMAT_V2
  workspaces: Record<string, {
    counter: number
    /** Absent only in authenticated v2 files written before the shred fence. */
    cryptoShredGeneration?: number
    dekGeneration: number
    /** Absent in authenticated v2 files written before recoverable rotation. */
    dekRotationReceipts?: Record<string, number>
    credentialVersions: Record<string, number>
    credentialMaterialKinds: Record<string, CredentialMaterialKindV1>
    /** Absent in authenticated v2 files written before field-set anchoring. */
    credentialFieldIds?: Record<string, string[]>
    credentialLifecycleStates: Record<string, CredentialLifecycleStateV1>
    credentialTypes: Record<string, string>
    pendingCredentialMutation?: PendingCredentialVersionMutationV1
  }>
}

type SealedAnchorFileV1 = {
  format: typeof ANCHOR_FORMAT_V2
  state: MutableAnchorStateV1
  mac: string
}

function unreadable(message: string): never {
  throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.UNREADABLE, message)
}

function backendUnavailable(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    message,
    { retryable: true },
  )
}

async function acquireMutationLock(lockPath: string) {
  try {
    const release = await lockfile.lock(lockPath, {
      lockfilePath: lockPath,
      realpath: false,
      stale: 30_000,
      update: 5_000,
      retries: { retries: 100, minTimeout: 25, maxTimeout: 100 },
    })
    return { release }
  } catch {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
      'Credential version anchor mutation lock is unavailable',
      { retryable: true },
    )
  }
}

function emptyState(): MutableAnchorStateV1 {
  return { format: ANCHOR_FORMAT_V2, workspaces: {} }
}

function copyWorkspaceState(
  state: MutableAnchorStateV1,
  workspaceId: string,
): WorkspaceCredentialVersionStateV1 | undefined {
  const workspace = state.workspaces[workspaceId]
  if (!workspace) return undefined
  return Object.freeze({
    counter: workspace.counter,
    cryptoShredGeneration: workspace.cryptoShredGeneration ?? 0,
    dekGeneration: workspace.dekGeneration,
    dekRotationReceipts: Object.freeze({ ...workspace.dekRotationReceipts }),
    credentialVersions: Object.freeze({ ...workspace.credentialVersions }),
    credentialMaterialKinds: Object.freeze({ ...workspace.credentialMaterialKinds }),
    credentialFieldIds: Object.freeze(Object.fromEntries(
      Object.entries(workspace.credentialFieldIds ?? {})
        .map(([providerId, fieldIds]) => [providerId, Object.freeze([...fieldIds])]),
    )),
    credentialLifecycleStates: Object.freeze({ ...workspace.credentialLifecycleStates }),
    credentialTypes: Object.freeze({ ...workspace.credentialTypes }),
  })
}

function canonicalState(state: MutableAnchorStateV1): string {
  const workspaces = Object.fromEntries(
    Object.entries(state.workspaces)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workspaceId, workspace]) => [workspaceId, {
        counter: workspace.counter,
        ...(workspace.cryptoShredGeneration === undefined
          ? {}
          : { cryptoShredGeneration: workspace.cryptoShredGeneration }),
        dekGeneration: workspace.dekGeneration,
        ...(workspace.dekRotationReceipts === undefined
          ? {}
          : { dekRotationReceipts: Object.fromEntries(
              Object.entries(workspace.dekRotationReceipts)
                .sort(([left], [right]) => left.localeCompare(right)),
            ) }),
        credentialVersions: Object.fromEntries(
          Object.entries(workspace.credentialVersions)
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        credentialMaterialKinds: Object.fromEntries(
          Object.entries(workspace.credentialMaterialKinds)
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        ...(workspace.credentialFieldIds === undefined
          ? {}
          : { credentialFieldIds: Object.fromEntries(
              Object.entries(workspace.credentialFieldIds)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([providerId, fieldIds]) => [providerId, [...fieldIds].sort()]),
            ) }),
        credentialLifecycleStates: Object.fromEntries(
          Object.entries(workspace.credentialLifecycleStates)
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        credentialTypes: Object.fromEntries(
          Object.entries(workspace.credentialTypes)
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        ...(workspace.pendingCredentialMutation === undefined
          ? {}
          : { pendingCredentialMutation: {
              ...workspace.pendingCredentialMutation,
              nextCredentialFieldIds: [...workspace.pendingCredentialMutation.nextCredentialFieldIds].sort(),
            } }),
      }]),
  )
  return JSON.stringify({ format: ANCHOR_FORMAT_V2, workspaces })
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isPendingMutationValid(value: unknown): value is PendingCredentialVersionMutationV1 {
  if (!value || typeof value !== 'object') return false
  const pending = value as Partial<PendingCredentialVersionMutationV1>
  return typeof pending.operationId === 'string'
    && pending.operationId.length > 0
    && pending.operationId.length <= 200
    && typeof pending.providerId === 'string'
    && pending.providerId.length > 0
    && isDigest(pending.expectedStateDigest)
    && isDigest(pending.nextStateDigest)
    && Number.isSafeInteger(pending.nextCredentialVersion)
    && pending.nextCredentialVersion! >= 1
    && (pending.nextCredentialMaterialKind === 'field-set' || pending.nextCredentialMaterialKind === 'none')
    && Array.isArray(pending.nextCredentialFieldIds)
    && pending.nextCredentialFieldIds.every((fieldId) => typeof fieldId === 'string' && fieldId.length > 0)
    && new Set(pending.nextCredentialFieldIds).size === pending.nextCredentialFieldIds.length
    && (pending.nextCredentialMaterialKind === 'field-set'
      ? pending.nextCredentialFieldIds.length > 0
      : pending.nextCredentialFieldIds.length === 0)
    && ['active', 'disabled', 'revoked', 'needs_reauth', 'intentionally_absent', 'instance_fallback_enabled']
      .includes(pending.nextCredentialLifecycleState as string)
    && typeof pending.nextCredentialType === 'string'
    && pending.nextCredentialType.length > 0
    && Number.isSafeInteger(pending.nextDekGeneration)
    && pending.nextDekGeneration! >= 1
}

function validateState(value: unknown): MutableAnchorStateV1 {
  if (!value || typeof value !== 'object') unreadable('Credential version anchor is malformed')
  const candidate = value as Partial<MutableAnchorStateV1>
  if (candidate.format !== ANCHOR_FORMAT_V2 || !candidate.workspaces || typeof candidate.workspaces !== 'object') {
    unreadable('Credential version anchor is malformed')
  }
  for (const workspace of Object.values(candidate.workspaces)) {
    if (
      !workspace
      || typeof workspace !== 'object'
      || !Number.isSafeInteger(workspace.counter)
      || (workspace.counter < 1 && !(
        workspace.counter === 0
        && workspace.pendingCredentialMutation !== undefined
        && Object.keys(workspace.credentialVersions ?? {}).length === 0
      ))
      || (workspace.cryptoShredGeneration !== undefined && (
        !Number.isSafeInteger(workspace.cryptoShredGeneration)
        || workspace.cryptoShredGeneration < 1
      ))
      || !Number.isSafeInteger(workspace.dekGeneration)
      || workspace.dekGeneration < 1
      || (workspace.dekRotationReceipts !== undefined && (
        typeof workspace.dekRotationReceipts !== 'object'
        || Object.entries(workspace.dekRotationReceipts).some(([operationId, generation]) => (
          operationId.length === 0
          || operationId.length > 200
          || !Number.isSafeInteger(generation)
          || generation < 2
        ))
      ))
      || !workspace.credentialVersions
      || typeof workspace.credentialVersions !== 'object'
      || !workspace.credentialMaterialKinds
      || typeof workspace.credentialMaterialKinds !== 'object'
      || (workspace.credentialFieldIds !== undefined
        && typeof workspace.credentialFieldIds !== 'object')
      || !workspace.credentialLifecycleStates
      || typeof workspace.credentialLifecycleStates !== 'object'
      || !workspace.credentialTypes
      || typeof workspace.credentialTypes !== 'object'
      || (workspace.pendingCredentialMutation !== undefined && !isPendingMutationValid(
        workspace.pendingCredentialMutation,
      ))
    ) unreadable('Credential version anchor is malformed')
    for (const [providerId, version] of Object.entries(workspace.credentialVersions)) {
      const materialKind = workspace.credentialMaterialKinds[providerId]
      const fieldIds = workspace.credentialFieldIds?.[providerId]
      const lifecycleState = workspace.credentialLifecycleStates[providerId]
      if (
        !Number.isSafeInteger(version)
        || version < 1
        || (materialKind !== 'field-set' && materialKind !== 'none')
        || (fieldIds !== undefined && (
          !Array.isArray(fieldIds)
          || fieldIds.some((fieldId) => typeof fieldId !== 'string' || fieldId.length === 0)
          || new Set(fieldIds).size !== fieldIds.length
          || (materialKind === 'field-set' ? fieldIds.length === 0 : fieldIds.length !== 0)
        ))
        || !['active', 'disabled', 'revoked', 'needs_reauth', 'intentionally_absent', 'instance_fallback_enabled'].includes(lifecycleState)
        || typeof workspace.credentialTypes[providerId] !== 'string'
        || workspace.credentialTypes[providerId].length === 0
      ) {
        unreadable('Credential version anchor is malformed')
      }
    }
    if (
      Object.keys(workspace.credentialMaterialKinds).some(
        (providerId) => workspace.credentialVersions[providerId] === undefined,
      )
      || Object.keys(workspace.credentialFieldIds ?? {}).some(
        (providerId) => workspace.credentialVersions[providerId] === undefined,
      )
      || Object.keys(workspace.credentialLifecycleStates).some(
        (providerId) => workspace.credentialVersions[providerId] === undefined,
      )
      || Object.keys(workspace.credentialTypes).some(
        (providerId) => workspace.credentialVersions[providerId] === undefined,
      )
    ) unreadable('Credential version anchor is malformed')
  }
  return candidate as MutableAnchorStateV1
}

function cloneState(state: MutableAnchorStateV1): MutableAnchorStateV1 {
  return JSON.parse(canonicalState(state)) as MutableAnchorStateV1
}

function isRecoverableMutation<T>(
  mutation: CredentialVersionMutationResultV1<T>,
): mutation is CredentialVersionMutationStateV1 & {
  readonly expectedStateDigest: string
  readonly nextStateDigest: string
  readonly commit: () => Promise<T>
} {
  return 'commit' in mutation
    && typeof mutation.commit === 'function'
    && 'expectedStateDigest' in mutation
    && 'nextStateDigest' in mutation
}

function isLifecycleOnlyMutation(
  current: WorkspaceCredentialVersionStateV1 | undefined,
  providerId: ProviderId,
  mutation: CredentialVersionMutationStateV1,
): boolean {
  if (!current) return false
  const currentFieldIds = [...(current.credentialFieldIds[providerId] ?? [])].sort()
  const nextFieldIds = [...mutation.nextCredentialFieldIds].sort()
  return mutation.nextCredentialVersion === current.credentialVersions[providerId]
    && mutation.nextCredentialMaterialKind === current.credentialMaterialKinds[providerId]
    && JSON.stringify(nextFieldIds) === JSON.stringify(currentFieldIds)
    && mutation.nextCredentialType === current.credentialTypes[providerId]
    && mutation.nextDekGeneration === current.dekGeneration
}

function pendingMutation<T>(
  providerId: ProviderId,
  mutation: CredentialVersionMutationStateV1 & {
    readonly expectedStateDigest: string
    readonly nextStateDigest: string
  },
): PendingCredentialVersionMutationV1 {
  return Object.freeze({
    operationId: randomUUID(),
    providerId,
    expectedStateDigest: mutation.expectedStateDigest,
    nextStateDigest: mutation.nextStateDigest,
    nextCredentialVersion: mutation.nextCredentialVersion,
    nextCredentialMaterialKind: mutation.nextCredentialMaterialKind,
    nextCredentialFieldIds: Object.freeze([...mutation.nextCredentialFieldIds].sort()),
    nextCredentialLifecycleState: mutation.nextCredentialLifecycleState,
    nextCredentialType: mutation.nextCredentialType,
    nextDekGeneration: mutation.nextDekGeneration,
  })
}

function stateWithPendingMutation(
  state: MutableAnchorStateV1,
  workspaceId: string,
  pending: PendingCredentialVersionMutationV1,
): MutableAnchorStateV1 {
  const next = cloneState(state)
  const current = next.workspaces[workspaceId]
  next.workspaces[workspaceId] = {
    counter: current?.counter ?? 0,
    ...(current?.cryptoShredGeneration === undefined
      ? {}
      : { cryptoShredGeneration: current.cryptoShredGeneration }),
    dekGeneration: current?.dekGeneration ?? pending.nextDekGeneration,
    dekRotationReceipts: { ...current?.dekRotationReceipts },
    credentialVersions: { ...current?.credentialVersions },
    credentialMaterialKinds: { ...current?.credentialMaterialKinds },
    credentialFieldIds: { ...current?.credentialFieldIds },
    credentialLifecycleStates: { ...current?.credentialLifecycleStates },
    credentialTypes: { ...current?.credentialTypes },
    pendingCredentialMutation: pending,
  }
  return next
}

function stateWithFinalizedMutation(
  state: MutableAnchorStateV1,
  workspaceId: string,
  pending: PendingCredentialVersionMutationV1,
): MutableAnchorStateV1 {
  const next = cloneState(state)
  const current = next.workspaces[workspaceId]!
  next.workspaces[workspaceId] = {
    counter: current.counter + 1,
    ...(current.cryptoShredGeneration === undefined
      ? {}
      : { cryptoShredGeneration: current.cryptoShredGeneration }),
    dekGeneration: pending.nextDekGeneration,
    dekRotationReceipts: { ...current.dekRotationReceipts },
    credentialVersions: {
      ...current.credentialVersions,
      [pending.providerId]: pending.nextCredentialVersion,
    },
    credentialMaterialKinds: {
      ...current.credentialMaterialKinds,
      [pending.providerId]: pending.nextCredentialMaterialKind,
    },
    credentialFieldIds: {
      ...current.credentialFieldIds,
      [pending.providerId]: [...pending.nextCredentialFieldIds],
    },
    credentialLifecycleStates: {
      ...current.credentialLifecycleStates,
      [pending.providerId]: pending.nextCredentialLifecycleState,
    },
    credentialTypes: {
      ...current.credentialTypes,
      [pending.providerId]: pending.nextCredentialType,
    },
  }
  return next
}

function recoverPendingState(
  state: MutableAnchorStateV1,
  workspaceId: string,
  durableStateDigest: string,
): MutableAnchorStateV1 {
  const pending = state.workspaces[workspaceId]?.pendingCredentialMutation
  if (!pending) return state
  if (durableStateDigest === pending.nextStateDigest) {
    return stateWithFinalizedMutation(state, workspaceId, pending)
  }
  if (durableStateDigest === pending.expectedStateDigest) {
    backendUnavailable('Credential mutation remains pending before database commit')
  }
  unreadable('Credential mutation recovery state failed authentication')
}

/** Test/development anchor. Production local-KEK composition uses the sealed file adapter. */
export function createInMemoryCredentialVersionAnchorV1(): WorkspaceCredentialVersionAnchorV2 {
  let state = emptyState()
  let queue = Promise.resolve()
  const anchor: WorkspaceCredentialVersionAnchorV2 = {
    async read(workspaceId: string) {
      await queue
      return copyWorkspaceState(state, workspaceId)
    },
    async readPendingMutation(workspaceId: string) {
      await queue
      const pending = state.workspaces[workspaceId]?.pendingCredentialMutation
      return pending ? Object.freeze({ ...pending }) : undefined
    },
    async recoverPendingMutation(workspaceId: string, durableStateDigest: string) {
      const operation = queue.then(() => {
        state = recoverPendingState(state, workspaceId, durableStateDigest)
      })
      queue = operation.catch(() => undefined)
      await operation
    },
    async withReadLock<T>(
      workspaceId: string,
      inspect: (readLocked: CredentialVersionAnchorReaderV1) => Promise<T>,
    ): Promise<T> {
      let result!: T
      const operation = queue.then(async () => {
        result = await inspect(async () => copyWorkspaceState(state, workspaceId))
      })
      queue = operation.catch(() => undefined)
      await operation
      return result
    },
    async withMutation<T>(
      workspaceId: string,
      providerId: ProviderId,
      mutate: (
        current: WorkspaceCredentialVersionStateV1 | undefined,
      ) => Promise<CredentialVersionMutationResultV1<T>>,
    ): Promise<T> {
      let result!: T
      const operation = queue.then(async () => {
        if (state.workspaces[workspaceId]?.pendingCredentialMutation) {
          unreadable('Credential mutation recovery is required')
        }
        const currentState = copyWorkspaceState(state, workspaceId)
        if ((currentState?.cryptoShredGeneration ?? 0) > 0) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        const mutation = await mutate(currentState)
        const currentVersion = currentState?.credentialVersions[providerId] ?? 0
        if (!isRecoverableMutation(mutation)) {
          if (mutation.nextCredentialVersion !== currentVersion + 1) {
            unreadable('Credential version anchor rejected a stale update')
          }
          const currentDekGeneration = currentState?.dekGeneration ?? 1
          if (mutation.nextDekGeneration !== currentDekGeneration) {
            unreadable('Credential version anchor rejected a stale DEK generation')
          }
          const legacy = pendingMutation(providerId, {
            ...mutation,
            expectedStateDigest: '0'.repeat(64),
            nextStateDigest: '1'.repeat(64),
          })
          state = stateWithFinalizedMutation(
            stateWithPendingMutation(state, workspaceId, legacy),
            workspaceId,
            legacy,
          )
          result = mutation.result
          return
        }
        if (
          mutation.nextCredentialVersion !== currentVersion + 1
          && !isLifecycleOnlyMutation(currentState, providerId, mutation)
        ) {
          unreadable('Credential version anchor rejected a stale update')
        }
        const currentDekGeneration = currentState?.dekGeneration ?? 1
        if (mutation.nextDekGeneration !== currentDekGeneration) {
          unreadable('Credential version anchor rejected a stale DEK generation')
        }
        if (!isDigest(mutation.expectedStateDigest) || !isDigest(mutation.nextStateDigest)) {
          unreadable('Credential mutation recovery digest is malformed')
        }
        const pending = pendingMutation(providerId, mutation)
        state = stateWithPendingMutation(state, workspaceId, pending)
        result = await mutation.commit()
        state = stateWithFinalizedMutation(state, workspaceId, pending)
      })
      queue = operation.catch(() => undefined)
      await operation
      return result
    },
    async withLifecycleMutation<T>(
      workspaceId: string,
      providerId: ProviderId,
      mutate: (
        current: WorkspaceCredentialVersionStateV1 | undefined,
      ) => Promise<CredentialLifecycleMutationResultV1<T>>,
    ): Promise<T> {
      let result!: T
      const operation = queue.then(async () => {
        const current = copyWorkspaceState(state, workspaceId)
        if ((current?.cryptoShredGeneration ?? 0) > 0) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        if (!current?.credentialVersions[providerId]) {
          unreadable('Credential lifecycle anchor is missing')
        }
        const mutation = await mutate(current)
        const next = cloneState(state)
        next.workspaces[workspaceId] = {
          ...next.workspaces[workspaceId]!,
          counter: current.counter + 1,
          credentialLifecycleStates: {
            ...current.credentialLifecycleStates,
            [providerId]: mutation.nextCredentialLifecycleState,
          },
        }
        state = next
        result = mutation.result
      })
      queue = operation.catch(() => undefined)
      await operation
      return result
    },
    async withCryptoShredMutation<T>(
      workspaceId: string,
      mutate: (
        current: WorkspaceCredentialVersionStateV1,
      ) => Promise<CryptoShredMutationResultV1<T>>,
    ): Promise<T> {
      let result!: T
      const operation = queue.then(async () => {
        let current = copyWorkspaceState(state, workspaceId)
        if ((current?.cryptoShredGeneration ?? 0) === 0) {
          const next = cloneState(state)
          const currentWorkspace = state.workspaces[workspaceId]
          next.workspaces[workspaceId] = {
            counter: (currentWorkspace?.counter ?? 0) + 1,
            cryptoShredGeneration: 1,
            dekGeneration: currentWorkspace?.dekGeneration ?? 1,
            dekRotationReceipts: { ...currentWorkspace?.dekRotationReceipts },
            credentialVersions: { ...currentWorkspace?.credentialVersions },
            credentialMaterialKinds: { ...currentWorkspace?.credentialMaterialKinds },
            credentialFieldIds: { ...currentWorkspace?.credentialFieldIds },
            credentialLifecycleStates: { ...currentWorkspace?.credentialLifecycleStates },
            credentialTypes: { ...currentWorkspace?.credentialTypes },
          }
          state = next
          current = copyWorkspaceState(state, workspaceId)!
        }
        result = (await mutate(current!)).result
      })
      queue = operation.catch(() => undefined)
      await operation
      return result
    },
    async withDekGenerationMutation<T>(
      workspaceId: string,
      mutate: (
        current: WorkspaceCredentialVersionStateV1 | undefined,
      ) => Promise<DekGenerationMutationResultV1<T>>,
    ): Promise<T> {
      let result!: T
      const operation = queue.then(async () => {
        const current = copyWorkspaceState(state, workspaceId)
        if (!current) unreadable('Credential DEK generation anchor is missing')
        if (current.cryptoShredGeneration > 0) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        const mutation = await mutate(current)
        if (mutation.nextDekGeneration !== current.dekGeneration + 1) {
          unreadable('Credential version anchor rejected a stale DEK rotation')
        }
        if (
          typeof mutation.nextDekRotationOperationId !== 'string'
          || mutation.nextDekRotationOperationId.length === 0
          || mutation.nextDekRotationOperationId.length > 200
        ) unreadable('Credential version anchor rejected an invalid DEK rotation operation')
        const next = cloneState(state)
        next.workspaces[workspaceId] = {
          ...next.workspaces[workspaceId]!,
          counter: current.counter + 1,
          dekGeneration: mutation.nextDekGeneration,
          dekRotationReceipts: {
            ...current.dekRotationReceipts,
            [mutation.nextDekRotationOperationId]: mutation.nextDekGeneration,
          },
        }
        state = next
        result = mutation.result
      })
      queue = operation.catch(() => undefined)
      await operation
      return result
    },
  }
  return Object.freeze(anchor)
}

export interface LocalCredentialVersionAnchorOptionsV1 {
  readonly anchorFilePath: string
  readonly loadKek: () => Promise<Uint8Array>
}

function deriveMacKey(kek: Uint8Array): Buffer {
  return Buffer.from(hkdfSync(
    'sha256',
    kek,
    Buffer.alloc(0),
    Buffer.from(ANCHOR_MAC_INFO_V1, 'utf8'),
    32,
  ))
}

async function loadMacKey(options: LocalCredentialVersionAnchorOptionsV1): Promise<Buffer> {
  let material: Uint8Array
  try {
    material = await options.loadKek()
  } catch {
    backendUnavailable('Credential version anchor KEK is unavailable')
  }
  if (!(material instanceof Uint8Array) || material.byteLength !== 32) {
    if (material instanceof Uint8Array) material.fill(0)
    backendUnavailable('Credential version anchor KEK is unavailable')
  }
  try {
    return deriveMacKey(material)
  } finally {
    material.fill(0)
  }
}

async function sealState(
  state: MutableAnchorStateV1,
  options: LocalCredentialVersionAnchorOptionsV1,
): Promise<string> {
  const macKey = await loadMacKey(options)
  try {
    const sealed: SealedAnchorFileV1 = {
      format: ANCHOR_FORMAT_V2,
      state,
      mac: createHmac('sha256', macKey)
        .update(canonicalState(state))
        .digest('base64'),
    }
    return `${JSON.stringify(sealed)}\n`
  } finally {
    macKey.fill(0)
  }
}

async function readSealedState(
  options: LocalCredentialVersionAnchorOptionsV1,
): Promise<MutableAnchorStateV1>
async function readSealedState(
  options: LocalCredentialVersionAnchorOptionsV1,
  readOptions: CredentialVersionAnchorReadOptionsV1,
): Promise<MutableAnchorStateV1 | undefined>
async function readSealedState(
  options: LocalCredentialVersionAnchorOptionsV1,
  readOptions?: CredentialVersionAnchorReadOptionsV1,
): Promise<MutableAnchorStateV1 | undefined> {
  let serialized: string
  try {
    serialized = await readFile(options.anchorFilePath, 'utf8')
  } catch (error) {
    if (
      readOptions?.allowUnprovisioned
      && error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT'
    ) return undefined
    unreadable('Credential version anchor is unreadable')
  }
  let parsed: Partial<SealedAnchorFileV1>
  try {
    parsed = JSON.parse(serialized) as Partial<SealedAnchorFileV1>
  } catch {
    unreadable('Credential version anchor is unreadable')
  }
  if (parsed.format !== ANCHOR_FORMAT_V2 || !parsed.state || typeof parsed.mac !== 'string') {
    unreadable('Credential version anchor is malformed')
  }
  const state = validateState(parsed.state)
  const macKey = await loadMacKey(options)
  try {
    const expected = createHmac('sha256', macKey).update(canonicalState(state)).digest()
    const actual = Buffer.from(parsed.mac, 'base64')
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      unreadable('Credential version anchor failed authentication')
    }
  } finally {
    macKey.fill(0)
  }
  return state
}

async function replaceSealedState(
  state: MutableAnchorStateV1,
  options: LocalCredentialVersionAnchorOptionsV1,
): Promise<void> {
  const temporaryPath = `${options.anchorFilePath}.${process.pid}.${randomUUID()}.pending`
  let temporary: Awaited<ReturnType<typeof open>> | undefined
  try {
    temporary = await open(temporaryPath, 'wx', 0o600)
    await temporary.writeFile(await sealState(state, options), 'utf8')
    await temporary.sync()
    await temporary.close()
    temporary = undefined
    await rename(temporaryPath, options.anchorFilePath)
    const directory = await open(dirname(options.anchorFilePath), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await temporary?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    if (error instanceof CredentialResolutionError) throw error
    unreadable('Credential version anchor could not be persisted')
  }
}

/** Explicit one-time provisioning; refuses to replace an existing anchor. */
export async function initializeLocalFileCredentialVersionAnchorV1(
  options: LocalCredentialVersionAnchorOptionsV1,
): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(options.anchorFilePath, 'wx', 0o600)
    await file.writeFile(await sealState(emptyState(), options), 'utf8')
    await file.sync()
    const directory = await open(dirname(options.anchorFilePath), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    if (error instanceof CredentialResolutionError) throw error
    unreadable('Credential version anchor could not be initialized')
  } finally {
    await file?.close().catch(() => undefined)
  }
}

/**
 * Local-KEK rollback anchor. The pre-provisioned file lives on the
 * operator-controlled durable mount beside the KEK, never in Postgres or a
 * workspace. One counter advances per workspace; authenticated provider
 * context is necessary because unchanged providers legitimately trail it.
 *
 * S1 rejects a replayed DB current-version pointer. It only narrows exposure:
 * S2 makes exfiltrated old ciphertext cryptographically dead by destroying the
 * superseded DEK generation.
 */
export function createLocalFileCredentialVersionAnchorV1(
  options: LocalCredentialVersionAnchorOptionsV1,
): WorkspaceCredentialVersionAnchorV2 {
  const anchor: WorkspaceCredentialVersionAnchorV2 = {
    async read(workspaceId: string, readOptions?: CredentialVersionAnchorReadOptionsV1) {
      const state = readOptions
        ? await readSealedState(options, readOptions)
        : await readSealedState(options)
      return state ? copyWorkspaceState(state, workspaceId) : undefined
    },
    async readPendingMutation(
      workspaceId: string,
      readOptions?: CredentialVersionAnchorReadOptionsV1,
    ) {
      const state = readOptions
        ? await readSealedState(options, readOptions)
        : await readSealedState(options)
      const pending = state?.workspaces[workspaceId]?.pendingCredentialMutation
      return pending ? Object.freeze({ ...pending }) : undefined
    },
    async recoverPendingMutation(workspaceId: string, durableStateDigest: string) {
      const lockPath = `${options.anchorFilePath}.lock`
      const lock = await acquireMutationLock(lockPath)
      try {
        const state = await readSealedState(options)
        const recovered = recoverPendingState(state, workspaceId, durableStateDigest)
        if (recovered !== state) await replaceSealedState(recovered, options)
      } finally {
        await lock.release()
      }
    },
    async withReadLock<T>(
      workspaceId: string,
      inspect: (readLocked: CredentialVersionAnchorReaderV1) => Promise<T>,
    ): Promise<T> {
      const lockPath = `${options.anchorFilePath}.lock`
      const lock = await acquireMutationLock(lockPath)
      try {
        return await inspect(async (readOptions?: CredentialVersionAnchorReadOptionsV1) => {
          const state = readOptions
            ? await readSealedState(options, readOptions)
            : await readSealedState(options)
          return state ? copyWorkspaceState(state, workspaceId) : undefined
        })
      } finally {
        await lock.release()
      }
    },
    async withMutation<T>(
      workspaceId: string,
      providerId: ProviderId,
      mutate: (
        current: WorkspaceCredentialVersionStateV1 | undefined,
      ) => Promise<CredentialVersionMutationResultV1<T>>,
    ): Promise<T> {
      const lockPath = `${options.anchorFilePath}.lock`
      const lock = await acquireMutationLock(lockPath)
      try {
        const state = await readSealedState(options)
        if (state.workspaces[workspaceId]?.pendingCredentialMutation) {
          unreadable('Credential mutation recovery is required')
        }
        const current = copyWorkspaceState(state, workspaceId)
        if ((current?.cryptoShredGeneration ?? 0) > 0) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        const mutation = await mutate(current)
        const currentVersion = current?.credentialVersions[providerId] ?? 0
        if (!isRecoverableMutation(mutation)) {
          if (mutation.nextCredentialVersion !== currentVersion + 1) {
            unreadable('Credential version anchor rejected a stale update')
          }
          const currentDekGeneration = current?.dekGeneration ?? 1
          if (mutation.nextDekGeneration !== currentDekGeneration) {
            unreadable('Credential version anchor rejected a stale DEK generation')
          }
          const legacy = pendingMutation(providerId, {
            ...mutation,
            expectedStateDigest: '0'.repeat(64),
            nextStateDigest: '1'.repeat(64),
          })
          await replaceSealedState(stateWithFinalizedMutation(
            stateWithPendingMutation(state, workspaceId, legacy),
            workspaceId,
            legacy,
          ), options)
          return mutation.result
        }
        if (
          mutation.nextCredentialVersion !== currentVersion + 1
          && !isLifecycleOnlyMutation(current, providerId, mutation)
        ) {
          unreadable('Credential version anchor rejected a stale update')
        }
        const currentDekGeneration = current?.dekGeneration ?? 1
        if (mutation.nextDekGeneration !== currentDekGeneration) {
          unreadable('Credential version anchor rejected a stale DEK generation')
        }
        if (!isDigest(mutation.expectedStateDigest) || !isDigest(mutation.nextStateDigest)) {
          unreadable('Credential mutation recovery digest is malformed')
        }
        const pending = pendingMutation(providerId, mutation)
        await replaceSealedState(stateWithPendingMutation(state, workspaceId, pending), options)
        const result = await mutation.commit()
        await replaceSealedState(stateWithFinalizedMutation(
          stateWithPendingMutation(state, workspaceId, pending),
          workspaceId,
          pending,
        ), options)
        return result
      } finally {
        await lock.release()
      }
    },
    async withLifecycleMutation<T>(
      workspaceId: string,
      providerId: ProviderId,
      mutate: (
        current: WorkspaceCredentialVersionStateV1 | undefined,
      ) => Promise<CredentialLifecycleMutationResultV1<T>>,
    ): Promise<T> {
      const lockPath = `${options.anchorFilePath}.lock`
      const lock = await acquireMutationLock(lockPath)
      try {
        const state = await readSealedState(options)
        const current = copyWorkspaceState(state, workspaceId)
        if ((current?.cryptoShredGeneration ?? 0) > 0) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        if (!current?.credentialVersions[providerId]) {
          unreadable('Credential lifecycle anchor is missing')
        }
        const mutation = await mutate(current)
        const next = cloneState(state)
        next.workspaces[workspaceId] = {
          ...next.workspaces[workspaceId]!,
          counter: current.counter + 1,
          credentialLifecycleStates: {
            ...current.credentialLifecycleStates,
            [providerId]: mutation.nextCredentialLifecycleState,
          },
        }
        await replaceSealedState(next, options)
        return mutation.result
      } finally {
        await lock.release()
      }
    },
    async withCryptoShredMutation<T>(
      workspaceId: string,
      mutate: (
        current: WorkspaceCredentialVersionStateV1,
      ) => Promise<CryptoShredMutationResultV1<T>>,
    ): Promise<T> {
      const lockPath = `${options.anchorFilePath}.lock`
      const lock = await acquireMutationLock(lockPath)
      try {
        let state = await readSealedState(options)
        let current = copyWorkspaceState(state, workspaceId)
        if ((current?.cryptoShredGeneration ?? 0) === 0) {
          const next = cloneState(state)
          const currentWorkspace = state.workspaces[workspaceId]
          next.workspaces[workspaceId] = {
            counter: (currentWorkspace?.counter ?? 0) + 1,
            cryptoShredGeneration: 1,
            dekGeneration: currentWorkspace?.dekGeneration ?? 1,
            dekRotationReceipts: { ...currentWorkspace?.dekRotationReceipts },
            credentialVersions: { ...currentWorkspace?.credentialVersions },
            credentialMaterialKinds: { ...currentWorkspace?.credentialMaterialKinds },
            credentialFieldIds: { ...currentWorkspace?.credentialFieldIds },
            credentialLifecycleStates: { ...currentWorkspace?.credentialLifecycleStates },
            credentialTypes: { ...currentWorkspace?.credentialTypes },
          }
          await replaceSealedState(next, options)
          state = next
          current = copyWorkspaceState(state, workspaceId)!
        }
        return (await mutate(current!)).result
      } finally {
        await lock.release()
      }
    },
    async withDekGenerationMutation<T>(
      workspaceId: string,
      mutate: (
        current: WorkspaceCredentialVersionStateV1 | undefined,
      ) => Promise<DekGenerationMutationResultV1<T>>,
    ): Promise<T> {
      const lockPath = `${options.anchorFilePath}.lock`
      const lock = await acquireMutationLock(lockPath)
      try {
        const state = await readSealedState(options)
        const current = copyWorkspaceState(state, workspaceId)
        if (!current) unreadable('Credential DEK generation anchor is missing')
        if (current.cryptoShredGeneration > 0) {
          unreadable('Workspace credential material was crypto-shredded')
        }
        const mutation = await mutate(current)
        if (mutation.nextDekGeneration !== current.dekGeneration + 1) {
          unreadable('Credential version anchor rejected a stale DEK rotation')
        }
        if (
          typeof mutation.nextDekRotationOperationId !== 'string'
          || mutation.nextDekRotationOperationId.length === 0
          || mutation.nextDekRotationOperationId.length > 200
        ) unreadable('Credential version anchor rejected an invalid DEK rotation operation')
        const next = cloneState(state)
        next.workspaces[workspaceId] = {
          ...next.workspaces[workspaceId]!,
          counter: current.counter + 1,
          dekGeneration: mutation.nextDekGeneration,
          dekRotationReceipts: {
            ...current.dekRotationReceipts,
            [mutation.nextDekRotationOperationId]: mutation.nextDekGeneration,
          },
        }
        await replaceSealedState(next, options)
        return mutation.result
      } finally {
        await lock.release()
      }
    },
  }
  return Object.freeze(anchor)
}
