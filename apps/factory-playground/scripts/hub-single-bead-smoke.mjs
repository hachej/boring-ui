import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { delimiter } from 'node:path'

const execFileAsync = promisify(execFile)
const PNPM_BIN = process.env.npm_execpath ?? 'pnpm'

function extendPath(cwd) {
  const localBins = [resolve(cwd, 'node_modules', '.bin'), resolve(process.cwd(), 'node_modules', '.bin')]
  return [...localBins, process.env.PATH ?? ''].filter(Boolean).join(delimiter)
}

async function main() {
  const root = await mkdtemp(resolve(tmpdir(), 'factory-single-bead-'))
  const stateRoot = resolve(root, '.factory-state')
  const epicKey = `smoke-${randomUUID().slice(0, 8)}`
  const featureName = 'Farewell API'
  const apiPort = 5630
  const uiPort = 5620
  const receiptPath = resolve(root, 'receipt.json')

  await writeFile(resolve(root, 'package.json'), JSON.stringify({ name: 'smoke-root', private: true }))
  await writeFile(resolve(root, '.gitignore'), '.worktrees/\n')
  const fixtureRoot = resolve(root, 'apps/factory-playground/src/fixtures/demo-repo')
  await mkdir(resolve(fixtureRoot, '..'), { recursive: true })
  await cp(resolve(process.cwd(), 'src/fixtures/demo-repo'), fixtureRoot, { recursive: true })
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'factory-smoke@example.invalid'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Factory Smoke'], { cwd: root })
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'smoke fixture'], { cwd: root })
  await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root })
  let host
  try {
    const appCwd = process.cwd()
    const hostEnv = {
      ...process.env,
      PATH: extendPath(appCwd),
      BORING_FACTORY_WORKSPACE_ROOT: root,
      BORING_FACTORY_STATE_ROOT: stateRoot,
      BORING_AGENT_SESSION_ROOT: resolve(stateRoot, 'sessions'),
      AGENT_API_PORT: String(apiPort),
      PORT: String(uiPort),
      BORING_FACTORY_SANDBOX_PROVIDER: 'local-simulation',
    }
    host = spawn(PNPM_BIN, ['exec', 'tsx', 'scripts/factory-host.mts'], {
      cwd: appCwd,
      env: hostEnv,
      stdio: 'inherit',
    })

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
    await execFileAsync(process.execPath, ['scripts/live-epic-acceptance.mjs'], {
      cwd: appCwd,
      env: {
        ...process.env,
        PATH: extendPath(appCwd),
        EPIC_KEY: epicKey,
        FEATURE_NAME: featureName,
        API_PORT: String(apiPort),
        RECEIPT_PATH: receiptPath,
      },
      timeout: 20 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  } finally {
    if (host) {
      host.kill('SIGTERM')
      await once(host, 'exit').catch(() => {})
    }
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
