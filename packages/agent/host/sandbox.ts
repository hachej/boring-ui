import { buildBwrapArgs } from '@hachej/boring-sandbox/providers/bwrap'
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
  readonly providerOptions?: unknown
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

export function createSandboxRuntimeModeAdapter(
  mode: RuntimeModeId,
  options: SandboxRuntimeModeOptions = {},
): RuntimeModeAdapter {
  const descriptor = getSandboxRuntimeModeDescriptor(mode)
  return createDescriptorRuntimeModeAdapter({
    descriptor,
    runtimeHost: agentSandboxRuntimeHostOperations,
    pairFactoryOptions: {
      sandboxHandleStore: options.sandboxHandleStore,
      providerOptions: options.providerOptions,
    },
  })
}

export function createAgentSandboxRuntimeModeAdapter(mode: RuntimeModeId = 'direct'): RuntimeModeAdapter {
  if (mode === 'remote-worker') return createRemoteWorkerModeAdapter()
  return createSandboxRuntimeModeAdapter(mode)
}

export type { RemoteWorkerModeAdapterOptions }

/** Explicit Agent-owned V0 construction seam. */
export function createRemoteWorkerModeAdapter(
  options: RemoteWorkerModeAdapterOptions = {},
): RuntimeModeAdapter {
  const adapter = createAgentOwnedRemoteWorkerModeAdapter(options)
  return {
    ...adapter,
    runtimeHost: agentSandboxRuntimeHostOperations,
    async create(context) {
      const bundle = await adapter.create(context)
      return {
        ...bundle,
        runtimeHost: agentSandboxRuntimeHostOperations,
      }
    },
  }
}
