import { resolve, sep } from 'node:path'
import { createProviderRuntimeModeAdapter, sandboxRuntimeHostOperations } from '@hachej/boring-agent/server'
import type { ModeContext, RuntimeModeAdapter } from '@hachej/boring-agent/server'
import type { FencedSandboxHandleStore, SandboxHandleFence, SandboxHandleKey } from '@hachej/boring-core/server'
import { createNodeWorkspace, disposeNodeWorkspace } from '@hachej/boring-sandbox/providers/node-workspace'
import { createDirectSandbox } from '@hachej/boring-sandbox/providers/direct'
import { PROVIDER_CONTRACT_VERSION } from '@hachej/boring-sandbox/shared'
import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import type { ExecOptions, ExecResult, Sandbox } from '@hachej/boring-agent/shared'

export const ECS_LOCAL_EFS_MODE = 'factory:ecs-local-efs'
export const AGENTCORE_REMOTE_EFS_MODE = 'factory:agentcore-remote-efs'
const AGENTCORE_PROVIDER = 'aws-agentcore'

/** Minimal host-owned protocol. The application supplies an authenticated AWS client implementation. */
export interface AgentCoreRuntimeClient {
  createSession(input: { idempotencyKey: string; runtimeCwd: string; signal: AbortSignal }): Promise<{ handle: Uint8Array; runtimeCwd: string }>
  resumeSession(input: { handle: Uint8Array; signal: AbortSignal }): Promise<{ runtimeCwd: string }>
  exec(input: { handle: Uint8Array; command: string; cwd: string; options?: ExecOptions }): Promise<ExecResult>
  deleteSession(input: { handle: Uint8Array }): Promise<void>
}

export interface SharedEfsRuntimeOptions {
  hostScope: string
  tenantId: string
  accessPointRoot: string
  runtimeRoot: string
  handleStore: FencedSandboxHandleStore
  agentCore: AgentCoreRuntimeClient
  leaseOwner: string
  leaseForMs?: number
}

function safeSegment(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') {
    throw new Error(`${name} is not a safe EFS path segment`)
  }
  return value
}

function mapping(options: SharedEfsRuntimeOptions, context: ModeContext) {
  const workspaceId = safeSegment(context.workspaceId ?? '', 'workspaceId')
  const tenantId = safeSegment(options.tenantId, 'tenantId')
  const accessPointRoot = resolve(options.accessPointRoot)
  const hostRoot = resolve(accessPointRoot, tenantId, workspaceId)
  if (!hostRoot.startsWith(`${accessPointRoot}${sep}`)) throw new Error('workspace escaped EFS access point')
  if (resolve(context.workspaceRoot) !== hostRoot) {
    throw new Error(`EFS workspace mapping mismatch: expected ${hostRoot}`)
  }
  const runtimeRoot = options.runtimeRoot.replace(/\/$/, '')
  if (!runtimeRoot.startsWith('/')) throw new Error('runtimeRoot must be absolute')
  return { workspaceId, hostRoot, runtimeRoot: `${runtimeRoot}/${tenantId}/${workspaceId}` }
}

function fenceOf(lease: { key: SandboxHandleKey; generation: number; leaseToken: string }): SandboxHandleFence {
  return { key: lease.key, generation: lease.generation, leaseToken: lease.leaseToken }
}

export function createEcsLocalEfsRuntimeMode(options: Omit<SharedEfsRuntimeOptions, 'handleStore' | 'agentCore' | 'leaseOwner'>): RuntimeModeAdapter {
  const provider: SandboxProviderV1 = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: ECS_LOCAL_EFS_MODE as SandboxProviderV1['providerId'],
    capabilities: { fs: 'readwrite', exec: true, watch: true, search: true, sourceOfTruth: 'storage-primary', provisioningSupport: true, providerContractVersion: PROVIDER_CONTRACT_VERSION, runtimeImage: false, networkIsolation: 'none', hardening: 'none', filesystemPersistence: 'durable' },
    resolveRuntimeRoot(context) { return mapping(options as SharedEfsRuntimeOptions, context).hostRoot },
    async create(context) {
      const { hostRoot } = mapping(options as SharedEfsRuntimeOptions, context)
      const runtimeContext = { runtimeCwd: hostRoot }
      const workspace = createNodeWorkspace(hostRoot, { runtimeContext })
      const sandbox = createDirectSandbox({ runtimeContext })
      return { workspace, sandbox, async dispose() { await sandbox.dispose?.(); await disposeNodeWorkspace(workspace) } }
    },
  }
  return createProviderRuntimeModeAdapter({ id: ECS_LOCAL_EFS_MODE, provider, runtimeHost: sandboxRuntimeHostOperations, workspaceFsCapability: 'strong', bash: { kind: 'host' }, filesystem: { kind: 'host' }, storageRoot: (ctx: ModeContext) => mapping(options as SharedEfsRuntimeOptions, ctx).hostRoot })
}

/** Creates the atomic Workspace/Sandbox pair; no builtin mode registry or auto detection is modified. */
export function createAgentCoreRemoteEfsRuntimeMode(options: SharedEfsRuntimeOptions): RuntimeModeAdapter {
  const leaseForMs = options.leaseForMs ?? 60_000
  const provider: SandboxProviderV1 = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: AGENTCORE_PROVIDER as SandboxProviderV1['providerId'],
    capabilities: { fs: 'readwrite', exec: true, watch: false, search: true, sourceOfTruth: 'storage-primary', provisioningSupport: true, providerContractVersion: PROVIDER_CONTRACT_VERSION, runtimeImage: 'unknown', networkIsolation: 'provider', hardening: 'provider', filesystemPersistence: 'durable' },
    resolveRuntimeRoot(context) { return mapping(options, context).runtimeRoot },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      const { workspaceId, hostRoot, runtimeRoot } = mapping(options, context)
      const key = { hostScope: options.hostScope, workspaceId, provider: AGENTCORE_PROVIDER, mode: AGENTCORE_REMOTE_EFS_MODE }
      const lease = await options.handleStore.claim({ key, leaseOwner: options.leaseOwner, leaseForMs })
      if (!lease) throw new Error('AgentCore session is owned by another runtime')
      if (lease.status === 'create-ambiguous') throw new Error(`AgentCore create outcome is ambiguous (${lease.idempotencyKey}); operator reconciliation required`)
      const fence = fenceOf(lease)
      const lifecycle = new AbortController()
      let handle = lease.handle
      try {
        if (handle) {
          const resumed = await options.agentCore.resumeSession({ handle, signal: lifecycle.signal })
          if (resumed.runtimeCwd !== runtimeRoot) throw new Error('AgentCore resumed runtime cwd does not match authorized EFS namespace')
        } else {
          const attempt = await options.handleStore.beginCreate(fence)
          if (!attempt || attempt.status !== 'started') throw new Error('AgentCore create could not acquire a durable idempotency key')
          const created = await options.agentCore.createSession({ idempotencyKey: attempt.idempotencyKey, runtimeCwd: runtimeRoot, signal: lifecycle.signal })
          handle = created.handle
          if (created.runtimeCwd !== runtimeRoot) {
            await options.agentCore.deleteSession({ handle })
            await options.handleStore.delete(fence, { outcome: 'succeeded', detail: 'runtime cwd mismatch', recordedAt: new Date().toISOString() })
            throw new Error('AgentCore created runtime cwd does not match authorized EFS namespace')
          }
          if (!await options.handleStore.update(fence, handle, 1)) throw new Error('AgentCore session handle lost its ownership fence')
        }
        const runtimeContext = { runtimeCwd: runtimeRoot }
        const workspace = createNodeWorkspace(hostRoot, { runtimeContext })
        const sandbox: Sandbox = {
          id: `${workspaceId}:${lease.generation}`,
          provider: AGENTCORE_PROVIDER,
          placement: 'remote',
          capabilities: ['exec', 'persistent-fs'],
          runtimeContext,
          exec: (command: string, execOptions?: ExecOptions) => options.agentCore.exec({
            handle: handle!,
            command,
            cwd: execOptions?.cwd ?? runtimeRoot,
            options: {
              ...execOptions,
              signal: execOptions?.signal
                ? AbortSignal.any([execOptions.signal, lifecycle.signal])
                : lifecycle.signal,
            },
          }),
        }
        let disposed = false
        return { workspace, sandbox, async dispose() { if (disposed) return; disposed = true; lifecycle.abort(); await disposeNodeWorkspace(workspace); await options.handleStore.release(fence) } }
      } catch (error) {
        lifecycle.abort()
        await options.handleStore.release(fence).catch(() => false)
        throw error
      }
    },
  }
  return createProviderRuntimeModeAdapter({ id: AGENTCORE_REMOTE_EFS_MODE, provider, runtimeHost: sandboxRuntimeHostOperations, workspaceFsCapability: 'strong', bash: { kind: 'remote' }, filesystem: { kind: 'remote-workspace' }, storageRoot: (ctx: ModeContext) => mapping(options, ctx).hostRoot })
}
