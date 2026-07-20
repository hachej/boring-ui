import {
  createDirectModeAdapter,
  createLocalModeAdapter,
  createVercelSandboxModeAdapter,
  type AgentRuntimeHostOperations,
  type BuiltinRuntimeModeId,
  type RuntimeModeAdapter,
} from '@hachej/boring-agent/server'
import type { SandboxHandleStore } from '@hachej/boring-agent/shared'
import {
  buildBwrapArgs,
  createBwrapSandboxProvider,
} from '@hachej/boring-sandbox/providers/bwrap'
import { createDirectSandboxProvider } from '@hachej/boring-sandbox/providers/direct'
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

export const sandboxRuntimeHostOperations: AgentRuntimeHostOperations = {
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

export interface SandboxRuntimeModeOptions {
  sandboxHandleStore?: SandboxHandleStore
}

export function createSandboxRuntimeModeAdapter(
  mode: BuiltinRuntimeModeId,
  options: SandboxRuntimeModeOptions = {},
): RuntimeModeAdapter {
  switch (mode) {
    case 'direct':
      return createDirectModeAdapter({
        provider: createDirectSandboxProvider(),
        runtimeHost: sandboxRuntimeHostOperations,
      })
    case 'local':
      return createLocalModeAdapter({
        provider: createBwrapSandboxProvider(),
        runtimeHost: sandboxRuntimeHostOperations,
      })
    case 'vercel-sandbox':
      return createVercelSandboxModeAdapter({
        provider: createVercelSandboxProvider({
          ...(options.sandboxHandleStore
            ? { store: options.sandboxHandleStore, orphanGuardMaxIdleMs: null }
            : {}),
        }),
        runtimeHost: sandboxRuntimeHostOperations,
        remoteRoot: VERCEL_SANDBOX_REMOTE_ROOT,
        workspaceRoot: VERCEL_SANDBOX_WORKSPACE_ROOT,
      })
    default:
      throw new Error(
        `Runtime mode "${String(mode)}" has no built-in adapter. Pass runtimeModeAdapter to use a custom sandbox mode.`,
      )
  }
}
