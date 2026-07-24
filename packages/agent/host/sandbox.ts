import {
  buildBwrapArgs,
  createBwrapSandboxProvider,
} from '@hachej/boring-sandbox/providers/bwrap'
import {
  createDirectSandboxProvider,
} from '@hachej/boring-sandbox/providers/direct'
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
  validatePath,
  withWorkspacePythonEnv,
} from '@hachej/boring-sandbox/providers/node-workspace'
import {
  createVercelSandboxProvider,
  VERCEL_SANDBOX_REMOTE_ROOT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '@hachej/boring-sandbox/providers/vercel-sandbox'

import type { SandboxHandleStore } from '../src/shared/sandbox-handle-store'
import type { AgentRuntimeHostOperations } from '../src/server/runtime/runtimeHost'
import type { BuiltinRuntimeModeId, RuntimeModeAdapter, RuntimeModeId } from '../src/server/runtime/mode'
import { createDirectModeAdapter } from '../src/server/runtime/modes/direct'
import { createLocalModeAdapter } from '../src/server/runtime/modes/local'
import { createVercelSandboxModeAdapter } from '../src/server/runtime/modes/vercel-sandbox'

export {
  buildBwrapArgs,
  createBwrapSandboxProvider,
  createNodeWorkspace,
  createDirectSandboxProvider,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
}
export { createDirectSandbox } from '@hachej/boring-sandbox/providers/direct'
export {
  createVercelSandboxProvider,
  createVercelProvisioningAdapter,
  VERCEL_SANDBOX_REMOTE_ROOT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '@hachej/boring-sandbox/providers/vercel-sandbox'

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
  isIgnoredDirName,
  buildBwrapArgs,
  withWorkspacePythonEnv,
}

export const sandboxRuntimeHostOperations = agentSandboxRuntimeHostOperations

export interface SandboxRuntimeModeOptions {
  readonly sandboxHandleStore?: SandboxHandleStore
}

export function createSandboxRuntimeModeAdapter(
  mode: BuiltinRuntimeModeId,
  options: SandboxRuntimeModeOptions = {},
): RuntimeModeAdapter {
  switch (mode) {
    case 'direct':
      return createDirectModeAdapter({
        provider: createDirectSandboxProvider(),
        runtimeHost: agentSandboxRuntimeHostOperations,
      })
    case 'local':
      return createLocalModeAdapter({
        provider: createBwrapSandboxProvider(),
        runtimeHost: agentSandboxRuntimeHostOperations,
      })
    case 'vercel-sandbox':
      return createVercelSandboxModeAdapter({
        provider: createVercelSandboxProvider({
          ...(options.sandboxHandleStore
            ? { store: options.sandboxHandleStore, orphanGuardMaxIdleMs: null }
            : {}),
        }),
        runtimeHost: agentSandboxRuntimeHostOperations,
        remoteRoot: VERCEL_SANDBOX_REMOTE_ROOT,
        workspaceRoot: VERCEL_SANDBOX_WORKSPACE_ROOT,
      })
    default:
      throw new Error(
        `Runtime mode "${String(mode)}" has no built-in adapter. Pass runtimeModeAdapter to use a custom sandbox mode.`,
      )
  }
}

export function createAgentSandboxRuntimeModeAdapter(mode: RuntimeModeId = 'direct'): RuntimeModeAdapter {
  return createSandboxRuntimeModeAdapter(mode as BuiltinRuntimeModeId)
}
