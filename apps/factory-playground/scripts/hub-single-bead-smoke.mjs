import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  let host
  try {
    const appCwd = process.cwd()
    const hostEnv = {
      ...process.env,
      PATH: extendPath(appCwd),
      BORING_FACTORY_WORKSPACE_ROOT: root,
      BORING_FACTORY_EPIC_KEY: epicKey,
      BORING_FACTORY_FEATURE_NAME: featureName,
      BORING_FACTORY_STATE_ROOT: stateRoot,
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
        EPIC_WT: root,
        EPIC_KEY: epicKey,
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
