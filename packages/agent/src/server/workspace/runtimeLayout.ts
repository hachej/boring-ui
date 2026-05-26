import { join, resolve } from 'node:path'

export const BORING_AGENT_DIR = '.boring-agent'
export const BORING_AGENT_GITIGNORE_CONTENT = '*\n'

export const BORING_AGENT_RUNTIME_DIR_NAMES = [
  'node',
  'venv',
  'sdk',
  'skills',
  'cache',
  'tmp',
] as const

export type BoringAgentRuntimeDirName = typeof BORING_AGENT_RUNTIME_DIR_NAMES[number]

export interface BoringAgentRuntimePaths {
  /** Runtime-visible workspace root. This is BORING_AGENT_WORKSPACE_ROOT. */
  workspaceRoot: string
  agentDir: string

  node: string
  nodeModules: string
  nodeBin: string

  venv: string
  venvBin: string
  venvPython: string

  sdk: string
  uvHome: string
  uvBin: string

  skills: string
  cache: string
  nodeCache: string
  uvCache: string
  pipCache: string
  tmp: string
}

export function getBoringAgentRuntimePaths(
  runtimeWorkspaceRoot: string,
): BoringAgentRuntimePaths {
  const workspaceRoot = resolve(runtimeWorkspaceRoot)
  const agentDir = join(workspaceRoot, BORING_AGENT_DIR)
  const node = join(agentDir, 'node')
  const venv = join(agentDir, 'venv')
  const sdk = join(agentDir, 'sdk')
  const uvHome = join(sdk, 'uv')
  const cache = join(agentDir, 'cache')

  return {
    workspaceRoot,
    agentDir,
    node,
    nodeModules: join(node, 'node_modules'),
    nodeBin: join(node, 'node_modules', '.bin'),
    venv,
    venvBin: join(venv, 'bin'),
    venvPython: join(venv, 'bin', 'python'),
    sdk,
    uvHome,
    uvBin: join(uvHome, 'bin'),
    skills: join(agentDir, 'skills'),
    cache,
    nodeCache: join(cache, 'npm'),
    uvCache: join(cache, 'uv'),
    pipCache: join(cache, 'pip'),
    tmp: join(agentDir, 'tmp'),
  }
}

export function getBoringAgentPathEntries(
  paths: BoringAgentRuntimePaths,
): string[] {
  return [paths.nodeBin, paths.venvBin, paths.uvBin]
}

export function getBoringAgentRuntimeEnv(
  paths: BoringAgentRuntimePaths,
  adapterCacheRoot: string = paths.cache,
): Record<string, string> {
  return {
    BORING_AGENT_WORKSPACE_ROOT: paths.workspaceRoot,
    VIRTUAL_ENV: paths.venv,
    UV_CACHE_DIR: join(adapterCacheRoot, 'uv'),
    PIP_CACHE_DIR: join(adapterCacheRoot, 'pip'),
    npm_config_cache: join(adapterCacheRoot, 'npm'),
  }
}
