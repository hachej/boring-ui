import {
  buildBwrapArgs,
  createLocalRuntimeDescriptor,
  type BwrapArgsOptions,
  type BwrapSandboxProviderOptions,
} from '@hachej/boring-sandbox/providers/bwrap'
import {
  assertRealPathWithinWorkspace,
  BORING_AGENT_DIR,
  BORING_AGENT_GITIGNORE_CONTENT,
  BORING_AGENT_RUNTIME_DIR_NAMES,
  createNodeWorkspace,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
  getNodeWorkspaceHostRoot,
  isIgnoredDirName,
  resolveRealWorkspacePath,
  validatePath,
  withWorkspacePythonEnv,
} from '@hachej/boring-sandbox/providers/node-workspace'
import {
  findSandboxRuntimeModeDescriptor as findRegisteredSandboxRuntimeModeDescriptor,
  resolveSandboxRuntimeModeDescriptor,
} from '@hachej/boring-sandbox/providers/registry'
import type {
  SandboxRuntimeModeDescriptorV1,
} from '@hachej/boring-sandbox/shared'
import {
  createRemoteWorkerModeAdapter as createAgentOwnedRemoteWorkerModeAdapter,
  type RemoteWorkerModeAdapterOptions,
} from '../src/server/runtime/modes/remote-worker'
import { createAgentResourceFilesystemBinding } from '@hachej/boring-bash/server'

import type { SandboxHandleStore } from '../src/shared/sandbox-handle-store'
import type { AgentRuntimeHostOperations } from '../src/server/runtime/runtimeHost'
import type { RuntimeModeAdapter, RuntimeModeId } from '../src/server/runtime/mode'
import { createDescriptorRuntimeModeAdapter } from '../src/server/runtime/modes/providerAdapter'

export {
  buildBwrapArgs,
  createNodeWorkspace,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
}

export const agentSandboxRuntimeHostOperations: AgentRuntimeHostOperations = {
  createNodeWorkspace,
  getNodeWorkspaceHostRoot,
  getBoringAgentRuntimePaths,
  getBoringAgentRuntimeEnv,
  getBoringAgentPathEntries,
  runtimeLayout: {
    agentDir: BORING_AGENT_DIR,
    runtimeDirNames: BORING_AGENT_RUNTIME_DIR_NAMES,
    gitignoreContent: BORING_AGENT_GITIGNORE_CONTENT,
  },
  validatePath,
  assertRealPathWithinWorkspace,
  resolveRealWorkspacePath,
  isIgnoredDirName,
  createAgentResourceFilesystemBinding,
  buildBwrapArgs,
  withWorkspacePythonEnv,
}

export const sandboxRuntimeHostOperations = agentSandboxRuntimeHostOperations

export interface SandboxRuntimeModeOptions {
  readonly sandboxHandleStore?: SandboxHandleStore
  readonly bwrap?: BwrapSandboxProviderOptions
}

type ResolvedBwrapPolicy = Required<Pick<
  BwrapArgsOptions,
  'namespaceProfile' | 'network' | 'dropAllCapabilities'
>>

function resolveBwrapPolicy(options: BwrapSandboxProviderOptions | undefined): ResolvedBwrapPolicy {
  const sandbox = options?.sandbox
  const namespaceProfile = sandbox?.namespaceProfile ?? 'full'
  return {
    namespaceProfile,
    network: sandbox?.network ?? 'shared',
    // Docker mode runs outside a nested user namespace. Never allow the outer
    // container's SYS_ADMIN capability to reach any local execution path.
    dropAllCapabilities: namespaceProfile === 'docker' || sandbox?.dropAllCapabilities === true,
  }
}

function withBwrapPolicy(
  runtimeHost: AgentRuntimeHostOperations,
  policy: ResolvedBwrapPolicy,
): AgentRuntimeHostOperations {
  return {
    ...runtimeHost,
    buildBwrapArgs(workspaceRoot, executionOptions) {
      return runtimeHost.buildBwrapArgs(workspaceRoot, {
        ...executionOptions,
        ...policy,
      })
    },
  }
}

export function getSandboxRuntimeModeDescriptor(
  mode: RuntimeModeId,
): SandboxRuntimeModeDescriptorV1 {
  try {
    return resolveSandboxRuntimeModeDescriptor(mode)
  } catch {
    throw new Error(
      `Runtime mode "${String(mode)}" has no built-in adapter. Pass runtimeModeAdapter to use a custom sandbox mode.`,
    )
  }
}

export function findSandboxRuntimeModeDescriptor(
  mode: RuntimeModeId,
): SandboxRuntimeModeDescriptorV1 | undefined {
  return findRegisteredSandboxRuntimeModeDescriptor(mode)
}

/** Built-in runtime layout root without exposing provider package constants to consumers. */
export function resolveBuiltinRuntimeLayoutRoot(
  mode: RuntimeModeId,
  workspaceRoot: string,
): string {
  return getSandboxRuntimeModeDescriptor(mode).resolveRuntimeRoot({
    workspaceRoot,
    sessionId: 'layout-only',
  })
}

export function createSandboxRuntimeDescriptorAdapter(
  descriptor: SandboxRuntimeModeDescriptorV1,
  options: SandboxRuntimeModeOptions = {},
): RuntimeModeAdapter {
  const policy = descriptor.id === 'local' ? resolveBwrapPolicy(options.bwrap) : undefined
  return createDescriptorRuntimeModeAdapter({
    descriptor,
    runtimeHost: policy
      ? withBwrapPolicy(agentSandboxRuntimeHostOperations, policy)
      : agentSandboxRuntimeHostOperations,
    pairFactoryOptions: {
      sandboxHandleStore: options.sandboxHandleStore,
    },
  })
}

export function createSandboxRuntimeModeAdapter(
  mode: RuntimeModeId,
  options: SandboxRuntimeModeOptions = {},
): RuntimeModeAdapter {
  const descriptor = mode === 'local'
    ? createLocalRuntimeDescriptor({
        ...options.bwrap,
        sandbox: {
          ...options.bwrap?.sandbox,
          ...resolveBwrapPolicy(options.bwrap),
        },
      })
    : getSandboxRuntimeModeDescriptor(mode)
  return createSandboxRuntimeDescriptorAdapter(
    descriptor,
    options,
  )
}

export function createAgentSandboxRuntimeModeAdapter(mode: RuntimeModeId = 'direct'): RuntimeModeAdapter {
  // TODO(#1220): remove this sole built-in path outside the Sandbox descriptor
  // registry when the secure remote-worker V1 deployment replaces Agent V0.
  if (mode === 'remote-worker') return createRemoteWorkerModeAdapter()
  return createSandboxRuntimeModeAdapter(mode)
}

export type { RemoteWorkerModeAdapterOptions }

/** Explicit Agent-owned V0 construction seam. */
export function createRemoteWorkerModeAdapter(
  options: RemoteWorkerModeAdapterOptions = {},
): RuntimeModeAdapter {
  return createAgentOwnedRemoteWorkerModeAdapter(
    options,
    agentSandboxRuntimeHostOperations,
  )
}
