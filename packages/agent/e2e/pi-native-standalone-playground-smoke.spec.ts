import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from './fixtures/loggingHarness'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test.describe('Standalone agent playground smoke', () => {
  test('serves source-backed chat chrome with growing dark-mode composer', async ({ page }, testInfo) => {
    const port = await findOpenPort()
    const server = spawnStandalonePlayground(port)
    const logs = { stdout: [] as string[], stderr: [] as string[] }

    server.stdout.on('data', (chunk) => logs.stdout.push(chunk.toString('utf8')))
    server.stderr.on('data', (chunk) => logs.stderr.push(chunk.toString('utf8')))

    try {
      await waitForHttpOk(`http://127.0.0.1:${port}/`, server, logs)

      await page.addInitScript(() => {
        localStorage.setItem('agent-playground:theme:v2', 'dark')
      })
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })

      await expect(page.getByRole('button', { name: 'chat' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Chat debug metadata' })).toBeVisible()

      const composer = page.locator('[data-boring-agent-part="composer-input"]')
      await expect(composer).toBeVisible({ timeout: 15_000 })

      const initial = await readComposerMetrics(page)
      expect(Math.round(initial.railHeight)).toBe(56)
      expect(initial.multiline).toBe('false')
      expect(initial.className).not.toContain('!h-10')
      expect(initial.className).not.toContain('!max-h-10')

      await composer.fill('ASd')
      await expect(composer).toHaveValue('ASd')
      const firstRowDraft = await readComposerMetrics(page)
      expect(Math.round(firstRowDraft.railHeight)).toBe(Math.round(initial.railHeight))
      expect(Math.round(firstRowDraft.inputGroupHeight)).toBe(Math.round(initial.inputGroupHeight))
      expect(Math.round(firstRowDraft.textareaHeight)).toBe(Math.round(initial.textareaHeight))
      expect(firstRowDraft.multiline).toBe('false')
      expect(firstRowDraft.className).toContain('[field-sizing:fixed]')
      expect(firstRowDraft.fieldSizing).toBe('fixed')

      await composer.press('Shift+Enter')
      await composer.type('asd')

      await expect(composer).toHaveValue('ASd\nasd')
      await expect.poll(async () => {
        const metrics = await readComposerMetrics(page)
        return Math.round(metrics.railHeight)
      }).toBeGreaterThan(Math.round(initial.railHeight))

      const multiline = await readComposerMetrics(page)
      expect(multiline.multiline).toBe('true')
      expect(multiline.cssHeight).toBe(`${Math.round(multiline.inputGroupHeight)}px`)
      expect(multiline.textareaHeight).toBeGreaterThan(initial.textareaHeight)
      expect(multiline.textareaClientHeight + 1).toBeGreaterThanOrEqual(multiline.textareaScrollHeight)

      await testInfo.attach('standalone-playground-composer-smoke.json', {
        body: Buffer.from(JSON.stringify({ port, initial, firstRowDraft, multiline }, null, 2), 'utf8'),
        contentType: 'application/json',
      })
    } finally {
      await testInfo.attach('standalone-playground-stdout.log', {
        body: Buffer.from(logs.stdout.join('') || '(empty)\n', 'utf8'),
        contentType: 'text/plain',
      })
      await testInfo.attach('standalone-playground-stderr.log', {
        body: Buffer.from(logs.stderr.join('') || '(empty)\n', 'utf8'),
        contentType: 'text/plain',
      })
      await stopProcess(server)
    }
  })
})

function spawnStandalonePlayground(port: number): ChildProcessWithoutNullStreams {
  return spawn(
    'pnpm',
    ['--filter', 'agent-playground', 'exec', 'tsx', 'src/server/index.ts'],
    {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        FRONTEND_PORT: String(port),
        FRONTEND_STRICT_PORT: '1',
        BORING_AGENT_INFOMANIAK_PRODUCT_ID: '108321',
        BORING_AGENT_INFOMANIAK_MODELS: 'e2e-smoke-model',
        BORING_AGENT_INFOMANIAK_MODEL: 'e2e-smoke-model',
        INFOMANIAK_API_TOKEN: 'e2e-smoke-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate open port')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

async function waitForHttpOk(
  url: string,
  child: ChildProcessWithoutNullStreams,
  logs: { stdout: string[]; stderr: string[] },
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null) {
      throw new Error(`standalone playground exited early (${child.exitCode})\n${formatLogs(logs)}`)
    }

    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Retry until the Vite server is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`standalone playground did not become ready at ${url}\n${formatLogs(logs)}`)
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return
  signalProcessGroup(child, 'SIGTERM')
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signalProcessGroup(child, 'SIGKILL')
      resolve()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall through to signaling the direct child when process groups are unavailable.
    }
  }
  child.kill(signal)
}

function formatLogs(logs: { stdout: string[]; stderr: string[] }): string {
  return [
    '--- stdout ---',
    logs.stdout.join('') || '(empty)',
    '--- stderr ---',
    logs.stderr.join('') || '(empty)',
  ].join('\n')
}

async function readComposerMetrics(page: import('@playwright/test').Page): Promise<{
  railHeight: number
  inputGroupHeight: number
  textareaHeight: number
  textareaClientHeight: number
  textareaScrollHeight: number
  multiline: string | null
  cssHeight: string
  fieldSizing: string | null
  className: string
}> {
  return page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-boring-agent-part="composer-rail"]')
    const inputGroup = document.querySelector<HTMLElement>('[data-boring-agent-part="composer"] [data-slot="input-group"]')
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-boring-agent-part="composer-input"]')
    if (!rail || !inputGroup || !textarea) throw new Error('composer nodes are missing')
    const textareaStyle = getComputedStyle(textarea)
    return {
      railHeight: rail.getBoundingClientRect().height,
      inputGroupHeight: inputGroup.getBoundingClientRect().height,
      textareaHeight: textarea.getBoundingClientRect().height,
      textareaClientHeight: textarea.clientHeight,
      textareaScrollHeight: textarea.scrollHeight,
      multiline: rail.getAttribute('data-composer-multiline'),
      cssHeight: rail.style.getPropertyValue('--composer-input-group-height'),
      fieldSizing: (textareaStyle as CSSStyleDeclaration & { fieldSizing?: string }).fieldSizing ?? null,
      className: textarea.className,
    }
  })
}
