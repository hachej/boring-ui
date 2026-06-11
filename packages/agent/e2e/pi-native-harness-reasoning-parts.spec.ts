import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { formatLogs, spawnBackend } from './helpers/backend'
import { navigateBrowserToBackend } from './helpers/browser'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

interface AssistantPartState {
  assistantMessages: Array<{
    id: string | null
    status: string | null
    partOrder: string[]
    reasoningTexts: string[]
    reasoningParagraphs: string[]
    toolGroupCount: number
    textPartCount: number
    text: string
  }>
}

test.describe('Pi-native harness-backed reasoning part ordering', () => {
  test('keeps multiple reasoning parts attached to one assistant before tools and final text', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_REASONING_PARTS: '2',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '150',
        BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS: '8',
      },
    })

    try {
      await page.addInitScript(() => {
        localStorage.setItem('boring-agent:v2:agent-playground:composer:show-thoughts', '1')
      })
      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

      const chat = page.locator('[data-boring-agent-part="chat"]')
      const composer = page.locator('[data-boring-agent-part="composer-input"]')
      const conversation = page.getByLabel('Agent conversation')

      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

      await composer.fill('baseline multiple reasoning parts')
      await page.locator('[data-boring-agent-part="composer-submit"]').click()

      await expect(page.getByRole('button', { name: 'Tool calls: Using search' })).toBeVisible({ timeout: 10_000 })
      const runningState = await readAssistantPartState(page)
      await testInfo.attach('pi-native-harness-reasoning-parts-running.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T3-running-tool',
          backend: 'scripted-pi-harness',
          state: runningState,
        }, null, 2), 'utf8'),
        contentType: 'application/json',
      })

      expect(runningState.assistantMessages).toHaveLength(1)
      expect(runningState.assistantMessages[0]).toMatchObject({
        status: 'streaming',
        reasoningTexts: [expect.stringContaining('Second reasoning visible')],
        reasoningParagraphs: ['Reasoning visible', 'Second reasoning visible'],
        toolGroupCount: 1,
        textPartCount: 0,
      })
      expect(runningState.assistantMessages[0]?.partOrder).toEqual([
        'message-reasoning',
        'message-tools',
      ])

      await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('chat-working')).toHaveCount(0, { timeout: 10_000 })

      const state = await readAssistantPartState(page)
      await testInfo.attach('pi-native-harness-reasoning-parts.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T3',
          backend: 'scripted-pi-harness',
          state,
        }, null, 2), 'utf8'),
        contentType: 'application/json',
      })

      expect(state.assistantMessages).toHaveLength(1)
      expect(state.assistantMessages[0]).toMatchObject({
        status: 'done',
        reasoningTexts: [expect.stringContaining('Second reasoning visible')],
        reasoningParagraphs: ['Reasoning visible', 'Second reasoning visible'],
        toolGroupCount: 1,
        textPartCount: 1,
      })
      expect(state.assistantMessages[0]?.partOrder).toEqual([
        'message-reasoning',
        'message-tools',
        'message-text',
      ])
      expect(countOccurrences(state.assistantMessages[0]?.text ?? '', 'PI_NATIVE_ASSISTANT_DONE')).toBe(1)
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

  test('opens collapsed message-level thoughts without changing assistant ordering', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_REASONING_PARTS: '2',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '150',
        BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS: '2',
      },
    })

    try {
      await page.addInitScript(() => {
        localStorage.setItem('boring-agent:v2:agent-playground:composer:show-thoughts', '0')
      })
      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

      const chat = page.locator('[data-boring-agent-part="chat"]')
      const composer = page.locator('[data-boring-agent-part="composer-input"]')
      const conversation = page.getByLabel('Agent conversation')

      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

      await composer.fill('baseline collapsed thoughts click')
      await page.locator('[data-boring-agent-part="composer-submit"]').click()
      await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('chat-working')).toHaveCount(0, { timeout: 10_000 })

      const reasoning = page.locator('[data-boring-agent-part="message-reasoning"]').first()
      await expect(reasoning).toHaveAttribute('data-state', 'closed')
      await expect(reasoning.getByText('Reasoning visible', { exact: true })).toBeHidden()

      const beforeOpen = await readAssistantPartState(page)
      expect(beforeOpen.assistantMessages).toHaveLength(1)
      expect(beforeOpen.assistantMessages[0]?.partOrder).toEqual([
        'message-reasoning',
        'message-tools',
        'message-text',
      ])

      await reasoning.getByRole('button', { name: /thoughts/i }).click()
      await expect(reasoning).toHaveAttribute('data-state', 'open')
      await expect(reasoning.getByText('Reasoning visible', { exact: true })).toBeVisible()
      await expect(reasoning.getByText('Second reasoning visible', { exact: true })).toBeVisible()

      const afterOpen = await readAssistantPartState(page)
      await testInfo.attach('pi-native-harness-reasoning-collapse-open.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T3-collapsed-thoughts-open',
          backend: 'scripted-pi-harness',
          beforeOpen,
          afterOpen,
        }, null, 2), 'utf8'),
        contentType: 'application/json',
      })

      expect(afterOpen.assistantMessages).toHaveLength(1)
      expect(afterOpen.assistantMessages[0]?.id).toBe(beforeOpen.assistantMessages[0]?.id)
      expect(afterOpen.assistantMessages[0]?.partOrder).toEqual(beforeOpen.assistantMessages[0]?.partOrder)
      expect(afterOpen.assistantMessages[0]).toMatchObject({
        status: 'done',
        reasoningParagraphs: ['Reasoning visible', 'Second reasoning visible'],
        toolGroupCount: 1,
        textPartCount: 1,
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

async function readAssistantPartState(page: Page): Promise<AssistantPartState> {
  return page.evaluate(() => {
    const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const partSelector = [
      '[data-boring-agent-part="message-reasoning"]',
      '[data-boring-agent-part="message-tools"]',
      '[data-boring-agent-part="message-text"]',
      '[data-boring-agent-part="message-notice"]',
    ].join(',')

    return {
      assistantMessages: Array.from(document.querySelectorAll('[data-boring-agent-part="message"]'))
        .filter((node) => node.getAttribute('data-boring-agent-message-role') === 'assistant')
        .map((node) => ({
          id: node.getAttribute('data-boring-agent-message-id'),
          status: node.getAttribute('data-boring-agent-message-status'),
          partOrder: Array.from(node.querySelectorAll(partSelector)).map((part) => part.getAttribute('data-boring-agent-part') ?? ''),
          reasoningTexts: Array.from(node.querySelectorAll('[data-boring-agent-part="message-reasoning"]')).map((part) => text(part)),
          reasoningParagraphs: Array.from(node.querySelectorAll('[data-boring-agent-part="message-reasoning"] p')).map((part) => text(part)),
          toolGroupCount: node.querySelectorAll('[data-boring-agent-part="message-tools"]').length,
          textPartCount: node.querySelectorAll('[data-boring-agent-part="message-text"]').length,
          text: text(node),
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
