import { getEnvSnapshot } from '../config/env'
import { getBoringAgentRuntimePaths } from '../workspace/runtimeLayout'

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
  const venvRoot = paths.venv
  const venvBin = paths.venvBin
  const shimBin = paths.bin
  const baseEnv = env ?? getEnvSnapshot()
  const pathParts = [shimBin, venvBin]
  const existingPath = baseEnv.PATH
  if (existingPath) {
    pathParts.push(...existingPath.split(':').filter((part) => part !== paths.legacyTopLevelVenvBin))
  }

  return {
    ...baseEnv,
    PATH: pathParts.join(':'),
    VIRTUAL_ENV: venvRoot,
    BORING_AGENT_WORKSPACE_ROOT:
      baseEnv.BORING_AGENT_WORKSPACE_ROOT ?? runtimeRoot,
  }
}
