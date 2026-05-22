import { getEnvSnapshot } from '../config/env'
import { getBoringAgentRuntimePaths } from '../workspace/runtimeLayout'

interface WorkspacePythonEnvOptions {
  workspaceRoot: string
  env?: Record<string, string | undefined>
  sandboxRoot?: string
}

function appendPathParts(
  pathParts: string[],
  pathValue: string | undefined,
): void {
  if (!pathValue) return
  for (const part of pathValue.split(':')) {
    if (!part || pathParts.includes(part)) continue
    pathParts.push(part)
  }
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
  const baseEnv = { ...(env ?? getEnvSnapshot()) }
  const pathParts = [shimBin, venvBin]
  appendPathParts(pathParts, baseEnv.PATH)

  delete baseEnv.PYTHONHOME

  return {
    ...baseEnv,
    HOME: runtimeRoot,
    PATH: pathParts.join(':'),
    VIRTUAL_ENV: venvRoot,
    BORING_AGENT_WORKSPACE_ROOT: runtimeRoot,
  }
}
