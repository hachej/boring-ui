import { join, resolve } from 'node:path'

import type { BoringAgentRuntimePaths } from '@hachej/boring-agent/server'

export function getBoringAgentRuntimePaths(
  runtimeWorkspaceRoot: string,
): BoringAgentRuntimePaths {
  const workspaceRoot = resolve(runtimeWorkspaceRoot)
  const agentDir = join(workspaceRoot, '.boring-agent')
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
