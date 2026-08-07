#!/usr/bin/env node
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import {
  allocateFreeLoopbackPorts,
  buildHermeticDevSmokeEnv,
  devSmokeTempRootPrefix,
  removeOwnedDevSmokeTempRoot,
} from '../src/server/devSmoke.ts'

const appDir = new URL('..', import.meta.url)
const composeProject = `boring-full-app-smoke-${process.pid}`
const composeArgs = ['compose', '-p', composeProject, '-f', 'docker-compose.dev.yml']
const activeChildren = new Set()
let browser
let composeAttempted = false
let composeEnv = process.env
let devServer
let cleanupPromise
let tempRoot

function trackChild(child) {
  activeChildren.add(child)
  const forget = () => activeChildren.delete(child)
  child.once('error', forget)
  child.once('exit', forget)
  return child
}

function spawnTracked(command, args, options = {}) {
  return trackChild(spawn(command, args, {
    cwd: appDir,
    stdio: 'inherit',
    detached: true,
    ...options,
  }))
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args, options)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve()
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`))
    })
  })
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function signalChildGroup(child, signal) {
  if (!child.pid || childHasExited(child)) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function waitForChildren(children, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (children.some((child) => !childHasExited(child)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return children.filter((child) => !childHasExited(child))
}

async function terminateActiveChildGroups() {
  const children = [...activeChildren]
  for (const child of children) signalChildGroup(child, 'SIGTERM')
  const remainingAfterTerm = await waitForChildren(children, 5_000)
  for (const child of remainingAfterTerm) signalChildGroup(child, 'SIGKILL')
  const remainingAfterKill = await waitForChildren(remainingAfterTerm, 2_000)
  if (remainingAfterKill.length > 0) {
    throw new Error(`failed to terminate ${remainingAfterKill.length} smoke child process group(s)`)
  }
}

async function performCleanup() {
  const cleanupErrors = []

  if (browser) {
    try {
      await browser.close()
    } catch (error) {
      cleanupErrors.push(error)
    } finally {
      browser = undefined
    }
  }

  let childGroupsStopped = false
  try {
    await terminateActiveChildGroups()
    childGroupsStopped = true
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (composeAttempted) {
    try {
      await run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], { env: composeEnv })
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (tempRoot && childGroupsStopped) {
    try {
      await removeOwnedDevSmokeTempRoot(tempRoot)
      tempRoot = undefined
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'dev console smoke cleanup failed')
  }
}

function cleanup() {
  cleanupPromise ??= performCleanup()
  return cleanupPromise
}

async function waitForFrontend(origin, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (devServer && childHasExited(devServer)) {
      throw new Error(`full-app dev server exited before becoming ready (${devServer.signalCode ?? devServer.exitCode})`)
    }
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // The dependency build and server startup are intentionally awaited by polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`timed out waiting for ${origin}`)
}

async function main() {
  const [postgresPort, backendPort, frontendPort] = await allocateFreeLoopbackPorts(3)
  tempRoot = await mkdtemp(join(tmpdir(), devSmokeTempRootPrefix(process.pid)))
  const backendOrigin = `http://127.0.0.1:${backendPort}`
  const frontendOrigin = `http://127.0.0.1:${frontendPort}`
  const exampleEnv = parseEnv(await readFile(new URL('../.env.example', import.meta.url), 'utf8'))
  const childEnv = buildHermeticDevSmokeEnv(exampleEnv, {
    NODE_ENV: 'development',
    ENABLE_DEV_LOGIN: '1',
    HOST: '127.0.0.1',
    PORT: String(backendPort),
    FRONTEND_PORT: String(frontendPort),
    DATABASE_URL: `postgres://boring:boring@127.0.0.1:${postgresPort}/boring_ui_v2`,
    BETTER_AUTH_URL: backendOrigin,
    CORS_ORIGINS: `${backendOrigin},${frontendOrigin}`,
    MAIL_FROM: '',
    MAIL_TRANSPORT_URL: '',
    SEND_WELCOME_EMAIL: 'false',
    BORING_AGENT_WORKSPACE_ROOT: join(tempRoot, 'workspaces'),
    BORING_AGENT_SESSION_ROOT: join(tempRoot, 'pi-sessions'),
  })
  composeEnv = {
    ...process.env,
    BORING_DEV_POSTGRES_PORT: String(postgresPort),
  }

  console.log('[dev-console-smoke] starting isolated Postgres on an allocated loopback port')
  composeAttempted = true
  await run('docker', [...composeArgs, 'up', '-d', '--wait'], { env: composeEnv })

  console.log('[dev-console-smoke] building full-app dependencies')
  await run('pnpm', ['run', 'build:deps'], { env: childEnv })

  console.log('[dev-console-smoke] applying migrations from the unedited .env.example')
  await run('pnpm', ['run', 'migrate'], { env: childEnv })

  console.log('[dev-console-smoke] starting full-app dev server on allocated loopback ports')
  devServer = spawnTracked('pnpm', ['exec', 'tsx', 'src/server/dev.ts'], { env: childEnv })
  devServer.once('error', (error) => {
    console.error('[dev-console-smoke] dev server failed:', error.message)
  })

  await waitForFrontend(frontendOrigin)
  await run('pnpm', ['exec', 'playwright', 'install', 'chromium'], { env: childEnv })

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`${frontendOrigin}/dev-login`)
  await page.waitForURL(/\/workspace\/[^/]+$/, { timeout: 30_000 })

  const session = await page.evaluate(async () => {
    const response = await fetch('/auth/get-session')
    return response.json()
  })
  if (!session?.user?.id) throw new Error('dev login did not establish an authenticated session')
  if (session.user.emailVerified !== true) {
    throw new Error('dev login did not create a verified local account')
  }

  const workspaceUrl = page.url()
  await page.reload()
  await page.waitForURL(workspaceUrl, { timeout: 30_000 })
  const reopened = await page.evaluate(async () => {
    const response = await fetch('/auth/get-session')
    return response.json()
  })
  if (reopened?.user?.id !== session.user.id || reopened.user.emailVerified !== true) {
    throw new Error('verified dev session did not survive workspace reopen')
  }

  console.log('[dev-console-smoke] PASS verified dev login created and reopened an authenticated workspace')
}

let signalHandled = false
function handleSignal(exitCode) {
  if (signalHandled) return
  signalHandled = true
  void cleanup().then(
    () => process.exit(exitCode),
    (error) => {
      console.error('[dev-console-smoke] cleanup failed:', error)
      process.exit(1)
    },
  )
}

process.once('SIGINT', () => handleSignal(130))
process.once('SIGTERM', () => handleSignal(143))

async function execute() {
  let primaryError
  try {
    await main()
  } catch (error) {
    primaryError = error
    console.error('[dev-console-smoke] FAIL:', error instanceof Error ? error.message : String(error))
  }

  try {
    await cleanup()
  } catch (cleanupError) {
    if (primaryError) {
      console.error('[dev-console-smoke] cleanup also failed:', cleanupError)
    } else {
      primaryError = cleanupError
      console.error('[dev-console-smoke] FAIL cleanup:', cleanupError)
    }
  }

  if (primaryError) process.exitCode = 1
}

void execute()
