import { join } from 'node:path'
import { getEnvSnapshot } from '../config/env'
import {
  getBoringAgentPathEntries,
  getBoringAgentRuntimePaths,
} from '../workspace/runtimeLayout'

interface WorkspacePythonEnvOptions {
  workspaceRoot: string
  env?: Record<string, string | undefined>
  sandboxRoot?: string
}

export function withWorkspacePythonEnv(
  opts: WorkspacePythonEnvOptions,
): Record<string, string | undefined> {
  const { workspaceRoot, env, sandboxRoot } = opts
  const runtimeRoot = sandboxRoot ?? workspaceRoot
  const paths = getBoringAgentRuntimePaths(runtimeRoot)
  const baseEnv = env ?? getEnvSnapshot()
  const pathParts = getBoringAgentPathEntries(paths)
  const existingPath = baseEnv.PATH
  if (existingPath) pathParts.push(existingPath)

  return {
    ...baseEnv,
    PATH: pathParts.join(':'),
    VIRTUAL_ENV: sandboxRoot ? paths.venv : baseEnv.VIRTUAL_ENV ?? paths.venv,
    BORING_AGENT_WORKSPACE_ROOT: sandboxRoot
      ? runtimeRoot
      : baseEnv.BORING_AGENT_WORKSPACE_ROOT ?? runtimeRoot,
  }
}
