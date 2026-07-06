import {
  getBoringSandboxPathEntries,
  getBoringSandboxRuntimePaths,
} from './runtimeLayout'

interface WorkspacePythonEnvOptions {
  workspaceRoot: string
  env?: Record<string, string | undefined>
  sandboxRoot?: string
  preserveHostHome?: boolean
}

export function withWorkspacePythonEnv(
  opts: WorkspacePythonEnvOptions,
): Record<string, string | undefined> {
  const { workspaceRoot, env, sandboxRoot, preserveHostHome } = opts
  const runtimeRoot = sandboxRoot ?? workspaceRoot
  const paths = getBoringSandboxRuntimePaths(runtimeRoot)
  const baseEnv = env ?? { ...process.env }
  const pathParts = getBoringSandboxPathEntries(paths)
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
