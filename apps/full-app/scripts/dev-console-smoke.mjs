#!/usr/bin/env node
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'

const appDir = new URL('..', import.meta.url)
const composeProject = `boring-full-app-smoke-${process.pid}`
const composeArgs = ['compose', '-p', composeProject, '-f', 'docker-compose.dev.yml']
const prompt = 'Reply with a short local development greeting.'
let devServer
let cleanedUp = false

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appDir,
      stdio: 'inherit',
      ...options,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve()
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`))
    })
  })
}

async function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  if (devServer && devServer.exitCode == null) {
    process.kill(-devServer.pid, 'SIGTERM')
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5_000)
      devServer.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  await run('docker', [...composeArgs, 'down', '--remove-orphans']).catch(() => {})
}

async function waitForFrontend(origin, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (devServer?.exitCode != null) {
      throw new Error(`full-app dev server exited before becoming ready (${devServer.exitCode})`)
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
  const exampleEnv = parseEnv(await readFile(new URL('../.env.example', import.meta.url), 'utf8'))
  const childEnv = {
    ...process.env,
    ...exampleEnv,
    NODE_ENV: 'development',
    ENABLE_DEV_LOGIN: '1',
  }

  console.log('[dev-console-smoke] starting isolated Postgres')
  await run('docker', [...composeArgs, 'up', '-d', '--wait'])

  console.log('[dev-console-smoke] building full-app dependencies')
  await run('pnpm', ['run', 'build:deps'], { env: childEnv })

  console.log('[dev-console-smoke] applying migrations from the unedited .env.example')
  await run('pnpm', ['run', 'migrate'], { env: childEnv })

  console.log('[dev-console-smoke] starting full-app dev server')
  devServer = spawn('pnpm', ['exec', 'tsx', 'src/server/dev.ts'], {
    cwd: appDir,
    env: childEnv,
    stdio: 'inherit',
    detached: true,
  })
  devServer.once('error', (error) => {
    console.error('[dev-console-smoke] dev server failed:', error.message)
  })

  const origin = 'http://localhost:5173'
  await waitForFrontend(origin)
  await run('pnpm', ['exec', 'playwright', 'install', 'chromium'])

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/api/v1/agent/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [{
            provider: 'infomaniak',
            id: 'Qwen/Qwen3.5-122B-A10B-FP8',
            label: 'Local smoke model',
            available: true,
          }],
          defaultModel: {
            provider: 'infomaniak',
            id: 'Qwen/Qwen3.5-122B-A10B-FP8',
          },
        }),
      })
    })

    await page.goto(`${origin}/dev-login`)
    await page.waitForURL(/\/workspace\/[^/]+$/, { timeout: 30_000 })

    const session = await page.evaluate(async () => {
      const response = await fetch('/auth/get-session')
      return response.json()
    })
    if (!session?.user?.id) throw new Error('dev login did not establish an authenticated session')
    if (session.user.emailVerified !== false) {
      throw new Error('fresh local account did not exercise the unverified development flow')
    }

    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    if (!await composer.isVisible()) {
      await page.getByRole('button', { name: 'Start new chat', exact: true }).click()
    }
    await composer.waitFor({ state: 'visible', timeout: 30_000 })
    await composer.fill(prompt)
    const promptRequest = page.waitForRequest((request) => (
      request.method() === 'POST' && /\/sessions\/[^/]+\/prompt$/.test(new URL(request.url()).pathname)
    ), { timeout: 30_000 })
    await page.locator('[data-boring-agent-part="composer-submit"]').click()

    const request = await promptRequest
    const body = request.postDataJSON()
    if (body?.content !== prompt) throw new Error('full-app prompt request did not contain the smoke prompt')

    console.log('[dev-console-smoke] PASS authenticated workspace console submitted one prompt')
  } finally {
    await browser.close()
  }
}

process.once('SIGINT', () => {
  void cleanup().finally(() => process.exit(130))
})
process.once('SIGTERM', () => {
  void cleanup().finally(() => process.exit(143))
})

main()
  .catch((error) => {
    console.error('[dev-console-smoke] FAIL:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(cleanup)
