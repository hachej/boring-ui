import { join, resolve } from 'node:path'

export interface BoringSandboxRuntimePaths {
  workspaceRoot: string
  agentDir: string
  nodeBin: string
  venv: string
  venvBin: string
  uvBin: string
}

export function getBoringSandboxRuntimePaths(runtimeWorkspaceRoot: string): BoringSandboxRuntimePaths {
  const workspaceRoot = resolve(runtimeWorkspaceRoot)
  const agentDir = join(workspaceRoot, '.boring-agent')
  const node = join(agentDir, 'node')
  const venv = join(agentDir, 'venv')
  const uvHome = join(agentDir, 'sdk', 'uv')

  return {
    workspaceRoot,
    agentDir,
    nodeBin: join(node, 'node_modules', '.bin'),
    venv,
    venvBin: join(venv, 'bin'),
    uvBin: join(uvHome, 'bin'),
  }
}

export function getBoringSandboxPathEntries(paths: BoringSandboxRuntimePaths): string[] {
  return [paths.nodeBin, paths.venvBin, paths.uvBin]
}
