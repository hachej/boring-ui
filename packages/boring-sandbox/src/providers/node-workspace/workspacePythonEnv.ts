import { join } from 'node:path'
import { getEnvSnapshot } from '../runtimeSupport'
import {
  getBoringAgentPathEntries,
  getBoringAgentRuntimePaths,
} from './runtimeLayout'

interface WorkspacePythonEnvOptions {
  workspaceRoot: string
  env?: Record<string, string | undefined>
  sandboxRoot?: string
  /**
   * When true, preserve the caller's HOME instead of rewriting it to the
   * runtime root. This is used by the direct (host-passthrough) sandbox where
   * the agent runs on the host with no FS isolation: keeping the host HOME lets
   * host-auth CLIs (gh, git, ...) resolve their config/credentials. Isolated
   * modes (bwrap, vercel-sandbox) leave this false so HOME stays inside the
   * runtime root. The workspace-scoped python/venv vars below are rewritten in
   * every mode regardless, so package resolution stays isolated.
   */
  preserveHostHome?: boolean
}

export function withWorkspacePythonEnv(
  opts: WorkspacePythonEnvOptions,
): Record<string, string | undefined> {
  const { workspaceRoot, env, sandboxRoot, preserveHostHome } = opts
  const runtimeRoot = sandboxRoot ?? workspaceRoot
  const paths = getBoringAgentRuntimePaths(runtimeRoot)
  const baseEnv = env ?? getEnvSnapshot()
  const pathParts = getBoringAgentPathEntries(paths)
  const existingPath = baseEnv.PATH
  if (existingPath) pathParts.push(existingPath)

  const home = preserveHostHome ? baseEnv.HOME : runtimeRoot

  return {
    ...baseEnv,
    PATH: pathParts.join(':'),
    HOME: home,
    VIRTUAL_ENV: paths.venv,
    PYTHONHOME: undefined,
    BORING_AGENT_WORKSPACE_ROOT: runtimeRoot,
  }
}
