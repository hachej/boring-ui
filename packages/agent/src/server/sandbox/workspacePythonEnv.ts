import { join } from 'node:path'

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
  const venvRoot = join(runtimeRoot, '.venv')
  const venvBin = join(venvRoot, 'bin')
  const shimBin = join(runtimeRoot, '.boring-agent', 'bin')
  const pathParts = [shimBin, venvBin]
  const existingPath = env?.PATH ?? process.env.PATH
  if (existingPath) pathParts.push(existingPath)

  return {
    ...process.env,
    ...env,
    PATH: pathParts.join(':'),
    VIRTUAL_ENV: env?.VIRTUAL_ENV ?? venvRoot,
    BORING_AGENT_WORKSPACE_ROOT:
      env?.BORING_AGENT_WORKSPACE_ROOT ?? runtimeRoot,
  }
}
