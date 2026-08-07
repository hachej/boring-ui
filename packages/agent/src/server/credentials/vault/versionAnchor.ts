import {
  createHmac,
  hkdfSync,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type { ProviderId } from '../../../shared/credentials'
import type { CredentialMaterialKindV1 } from './persistence'

const ANCHOR_FORMAT_V1 = 'boring.credential-version-anchor.v1' as const
const ANCHOR_MAC_INFO_V1 = 'boring.credential-version-anchor.mac.v1'

export interface WorkspaceCredentialVersionStateV1 {
  readonly counter: number
  readonly credentialVersions: Readonly<Record<string, number>>
  readonly credentialMaterialKinds: Readonly<Record<string, CredentialMaterialKindV1>>
}

export interface CredentialVersionMutationResultV1<T> {
  readonly nextCredentialVersion: number
  readonly nextCredentialMaterialKind: CredentialMaterialKindV1
  readonly result: T
}

export interface WorkspaceCredentialVersionAnchorV1 {
  read(workspaceId: string): Promise<WorkspaceCredentialVersionStateV1 | undefined>
  /**
   * Holds the external workspace mutation lock through the supplied DB CAS.
   * If the DB commit succeeds but advancing this external anchor fails, the
   * mismatch deliberately fail-stops; accepting DB-ahead state would turn an
   * attacker replay into an automatic rollback. S1 prefers security over
   * availability here and does not claim cross-store crash atomicity.
   */
  withMutation<T>(
    workspaceId: string,
    providerId: ProviderId,
    mutate: (
      current: WorkspaceCredentialVersionStateV1 | undefined,
    ) => Promise<CredentialVersionMutationResultV1<T>>,
  ): Promise<T>
}

type MutableAnchorStateV1 = {
  format: typeof ANCHOR_FORMAT_V1
  workspaces: Record<string, {
    counter: number
    credentialVersions: Record<string, number>
    credentialMaterialKinds: Record<string, CredentialMaterialKindV1>
  }>
}

type SealedAnchorFileV1 = {
  format: typeof ANCHOR_FORMAT_V1
  state: MutableAnchorStateV1
  mac: string
}

function unreadable(message: string): never {
  throw new CredentialResolutionError(CREDENTIAL_ERROR_CODES.UNREADABLE, message)
}

function emptyState(): MutableAnchorStateV1 {
  return { format: ANCHOR_FORMAT_V1, workspaces: {} }
}

function copyWorkspaceState(
  state: MutableAnchorStateV1,
  workspaceId: string,
): WorkspaceCredentialVersionStateV1 | undefined {
  const workspace = state.workspaces[workspaceId]
  if (!workspace) return undefined
  return Object.freeze({
    counter: workspace.counter,
    credentialVersions: Object.freeze({ ...workspace.credentialVersions }),
    credentialMaterialKinds: Object.freeze({ ...workspace.credentialMaterialKinds }),
  })
}

function canonicalState(state: MutableAnchorStateV1): string {
  const workspaces = Object.fromEntries(
    Object.entries(state.workspaces)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workspaceId, workspace]) => [workspaceId, {
        counter: workspace.counter,
        credentialVersions: Object.fromEntries(
          Object.entries(workspace.credentialVersions)
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        credentialMaterialKinds: Object.fromEntries(
          Object.entries(workspace.credentialMaterialKinds)
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
      }]),
  )
  return JSON.stringify({ format: ANCHOR_FORMAT_V1, workspaces })
}

function validateState(value: unknown): MutableAnchorStateV1 {
  if (!value || typeof value !== 'object') unreadable('Credential version anchor is malformed')
  const candidate = value as Partial<MutableAnchorStateV1>
  if (candidate.format !== ANCHOR_FORMAT_V1 || !candidate.workspaces || typeof candidate.workspaces !== 'object') {
    unreadable('Credential version anchor is malformed')
  }
  for (const workspace of Object.values(candidate.workspaces)) {
    if (
      !workspace
      || typeof workspace !== 'object'
      || !Number.isSafeInteger(workspace.counter)
      || workspace.counter < 1
      || !workspace.credentialVersions
      || typeof workspace.credentialVersions !== 'object'
      || !workspace.credentialMaterialKinds
      || typeof workspace.credentialMaterialKinds !== 'object'
    ) unreadable('Credential version anchor is malformed')
    for (const [providerId, version] of Object.entries(workspace.credentialVersions)) {
      const materialKind = workspace.credentialMaterialKinds[providerId]
      if (
        !Number.isSafeInteger(version)
        || version < 1
        || (materialKind !== 'field-set' && materialKind !== 'none')
      ) {
        unreadable('Credential version anchor is malformed')
      }
    }
    if (
      Object.keys(workspace.credentialMaterialKinds).some(
        (providerId) => workspace.credentialVersions[providerId] === undefined,
      )
    ) unreadable('Credential version anchor is malformed')
  }
  return candidate as MutableAnchorStateV1
}

function cloneState(state: MutableAnchorStateV1): MutableAnchorStateV1 {
  return JSON.parse(canonicalState(state)) as MutableAnchorStateV1
}

/** Test/development anchor. Production local-KEK composition uses the sealed file adapter. */
export function createInMemoryCredentialVersionAnchorV1(): WorkspaceCredentialVersionAnchorV1 {
  let state = emptyState()
  let queue = Promise.resolve()
  const anchor: WorkspaceCredentialVersionAnchorV1 = {
    async read(workspaceId: string) {
      await queue
      return copyWorkspaceState(state, workspaceId)
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
        const mutation = await mutate(copyWorkspaceState(state, workspaceId))
        const current = state.workspaces[workspaceId]
        const currentVersion = current?.credentialVersions[providerId] ?? 0
        if (mutation.nextCredentialVersion !== currentVersion + 1) {
          unreadable('Credential version anchor rejected a stale update')
        }
        const next = cloneState(state)
        next.workspaces[workspaceId] = {
          counter: (current?.counter ?? 0) + 1,
          credentialVersions: {
            ...current?.credentialVersions,
            [providerId]: mutation.nextCredentialVersion,
          },
          credentialMaterialKinds: {
            ...current?.credentialMaterialKinds,
            [providerId]: mutation.nextCredentialMaterialKind,
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
    unreadable('Credential version anchor KEK is unavailable')
  }
  if (!(material instanceof Uint8Array) || material.byteLength !== 32) {
    material?.fill(0)
    unreadable('Credential version anchor KEK is unavailable')
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
      format: ANCHOR_FORMAT_V1,
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
): Promise<MutableAnchorStateV1> {
  let parsed: Partial<SealedAnchorFileV1>
  try {
    parsed = JSON.parse(await readFile(options.anchorFilePath, 'utf8')) as Partial<SealedAnchorFileV1>
  } catch {
    unreadable('Credential version anchor is unreadable')
  }
  if (parsed.format !== ANCHOR_FORMAT_V1 || !parsed.state || typeof parsed.mac !== 'string') {
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
): WorkspaceCredentialVersionAnchorV1 {
  const anchor: WorkspaceCredentialVersionAnchorV1 = {
    async read(workspaceId: string) {
      return copyWorkspaceState(await readSealedState(options), workspaceId)
    },
    async withMutation<T>(
      workspaceId: string,
      providerId: ProviderId,
      mutate: (
        current: WorkspaceCredentialVersionStateV1 | undefined,
      ) => Promise<CredentialVersionMutationResultV1<T>>,
    ): Promise<T> {
      const lockPath = `${options.anchorFilePath}.lock`
      let lock: Awaited<ReturnType<typeof open>>
      try {
        lock = await open(lockPath, 'wx', 0o600)
      } catch {
        unreadable('Credential version anchor mutation is already locked')
      }
      try {
        // A process crash can leave the lock behind. Future writes then fail
        // closed until operator cleanup rather than guessing lock ownership.
        const state = await readSealedState(options)
        const current = copyWorkspaceState(state, workspaceId)
        const mutation = await mutate(current)
        const currentWorkspace = state.workspaces[workspaceId]
        const currentVersion = currentWorkspace?.credentialVersions[providerId] ?? 0
        if (mutation.nextCredentialVersion !== currentVersion + 1) {
          unreadable('Credential version anchor rejected a stale update')
        }
        const next = cloneState(state)
        next.workspaces[workspaceId] = {
          counter: (currentWorkspace?.counter ?? 0) + 1,
          credentialVersions: {
            ...currentWorkspace?.credentialVersions,
            [providerId]: mutation.nextCredentialVersion,
          },
          credentialMaterialKinds: {
            ...currentWorkspace?.credentialMaterialKinds,
            [providerId]: mutation.nextCredentialMaterialKind,
          },
        }
        await replaceSealedState(next, options)
        return mutation.result
      } finally {
        await lock.close().catch(() => undefined)
        await unlink(lockPath).catch(() => undefined)
      }
    },
  }
  return Object.freeze(anchor)
}
