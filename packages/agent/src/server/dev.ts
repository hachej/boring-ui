import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveWorkspaceRoot } from './config/workspaceRoot'

const DEFAULT_CLI_PORT = 5200

export async function startDevServer(port = 0) {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const cliRoot = path.resolve(thisDir, '..', '..', '..', 'cli')
  const repoRoot = path.resolve(cliRoot, '..', '..')
  const cliPort = port > 0 ? port : DEFAULT_CLI_PORT
  const buildDeps = spawnSync('pnpm', ['--filter', '@hachej/boring-ui-cli...', 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (buildDeps.status !== 0) {
    throw new Error(`failed to build @hachej/boring-ui-cli dependency graph for dev server (exit ${buildDeps.status ?? 'unknown'})`)
  }
  const build = spawnSync('pnpm', ['--filter', '@hachej/boring-ui-cli', 'run', 'build:front'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (build.status !== 0) {
    throw new Error(`failed to build @hachej/boring-ui-cli frontend for dev server (exit ${build.status ?? 'unknown'})`)
  }
  const child = spawn(
    'node',
    [
      '--import',
      'tsx',
      'src/index.ts',
      '--mode',
      'local',
      '--port',
      String(cliPort),
      '--host',
      '127.0.0.1',
      resolveWorkspaceRoot(),
    ],
    {
      cwd: cliRoot,
      env: process.env,
      stdio: 'inherit',
    },
  )
  return { child, address: `http://127.0.0.1:${cliPort}` }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('/dev.ts') || process.argv[1].endsWith('/dev.js'))
) {
  const { child } = await startDevServer(0)
  process.exitCode = await new Promise<number>((resolve) => {
    child.once('exit', (code) => resolve(code ?? 0))
  })
}

export type AgentDevServerProcess = ChildProcess
