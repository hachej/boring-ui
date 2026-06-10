import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { formatLogs, spawnBackend } from './helpers/backend'
import { navigateBrowserToBackend } from './helpers/browser'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

interface ToolLivenessState {
  assistantMessages: Array<{
    id: string | null
    status: string | null
    text: string
    toolGroupCount: number
    toolStates: string[]
    toolLabels: string[]
  }>
}

test.describe('Pi-native harness-backed tool liveness', () => {
  test('keeps a slow tool visibly running, then settles the same assistant tool group in place', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '500',
        BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS: '10',
      },
    })

    try {
      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

      const chat = page.locator('[data-boring-agent-part="chat"]')
      const composer = page.locator('[data-boring-agent-part="composer-input"]')
      const submit = page.locator('[data-boring-agent-part="composer-submit"]')
      const conversation = page.getByLabel('Agent conversation')

      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

      await composer.fill('baseline slow tool liveness')
      await submit.click()

      const runningTool = page.getByRole('button', { name: /Tool calls: Using command/i })
      await expect(runningTool).toBeVisible({ timeout: 10_000 })
      await expect(runningTool).toContainText(/Running \d+s/)
      await expect(runningTool).toContainText(/Running [1-9]\d*s/, { timeout: 4_000 })
      await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toHaveCount(0)

      const running = await readToolLivenessState(page)
      expect(running.assistantMessages).toHaveLength(1)
      expect(running.assistantMessages[0]).toMatchObject({
        status: 'streaming',
        toolGroupCount: 1,
        toolStates: ['running'],
      })
      expect(running.assistantMessages[0]?.text).toMatch(/Running \d+s/)
      expect(running.assistantMessages[0]?.toolLabels).toEqual([
        expect.stringMatching(/Tool calls: Using command/i),
      ])

      // The 10 x 500ms scripted tool delay keeps this safely inside the live window.
      await page.waitForTimeout(1_000)
      await expect(runningTool).toBeVisible()

      await expect(page.getByRole('button', { name: /Tool calls: Used command/i })).toBeVisible({ timeout: 10_000 })
      await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('chat-working')).toHaveCount(0, { timeout: 10_000 })

      const settled = await readToolLivenessState(page)
      expect(settled.assistantMessages).toHaveLength(1)
      expect(settled.assistantMessages[0]?.id).toBe(running.assistantMessages[0]?.id)
      expect(settled.assistantMessages[0]).toMatchObject({
        status: 'done',
        toolGroupCount: 1,
        toolStates: ['settled'],
      })
      expect(settled.assistantMessages[0]?.toolLabels).toEqual([
        expect.stringMatching(/Tool calls: Used command/i),
      ])
      expect(settled.assistantMessages[0]?.toolLabels.join(' ')).not.toMatch(/Tool calls: Using command/i)
      expect(settled.assistantMessages[0]?.text).not.toMatch(/Running \d+s/)
      expect(countOccurrences(settled.assistantMessages[0]?.text ?? '', 'PI_NATIVE_ASSISTANT_DONE')).toBe(1)

      await testInfo.attach('pi-native-harness-tool-liveness.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T4',
          backend: 'scripted-pi-harness',
          running,
          settled,
        }, null, 2), 'utf8'),
        contentType: 'application/json',
      })
    } finally {
      await testInfo.attach('backend-stdout.log', {
        body: Buffer.from(`${backend.logs.stdout.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      await testInfo.attach('backend-stderr.log', {
        body: Buffer.from(`${backend.logs.stderr.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('backend-combined.log', {
          body: Buffer.from(formatLogs(backend.logs), 'utf8'),
          contentType: 'text/plain',
        })
      }
      await backend.stop()
    }
  })
})

async function readToolLivenessState(page: Page): Promise<ToolLivenessState> {
  return page.evaluate(() => {
    const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    return {
      assistantMessages: Array.from(document.querySelectorAll('[data-boring-agent-part="message"]'))
        .filter((node) => node.getAttribute('data-boring-agent-message-role') === 'assistant')
        .map((node) => ({
          id: node.getAttribute('data-boring-agent-message-id'),
          status: node.getAttribute('data-boring-agent-message-status'),
          text: text(node),
          toolGroupCount: node.querySelectorAll('[data-boring-agent-part="message-tools"]').length,
          toolStates: Array.from(node.querySelectorAll('[data-boring-agent-tool-state]'))
            .map((tool) => tool.getAttribute('data-boring-agent-tool-state') ?? ''),
          toolLabels: Array.from(node.querySelectorAll('[data-boring-agent-part="message-tools"] button'))
            .map((button) => button.getAttribute('aria-label') ?? text(button)),
        })),
    }
  })
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = text.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}
