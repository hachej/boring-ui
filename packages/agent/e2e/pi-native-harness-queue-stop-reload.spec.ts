import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { assertChatDomInvariants, readChatDomState } from './helpers/chat-state'
import { formatLogs, spawnBackend } from './helpers/backend'
import { navigateBrowserToBackend } from './helpers/browser'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test.describe('Pi-native harness-backed queue stop reload', () => {
  test('preserves queued follow-ups across reload, clears them on Stop, and auto-posts them on Escape', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '250',
        BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS: '20',
      },
    })

    try {
      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)

      const chat = page.locator('[data-boring-agent-part="chat"]')
      const composer = page.locator('[data-boring-agent-part="composer-input"]')
      const submit = page.locator('[data-boring-agent-part="composer-submit"]')
      const conversation = page.getByLabel('Agent conversation')
      const queuePreview = page.locator('[data-boring-agent-part="composer-queue-preview"]')
      const queuePreviewText = page.locator('[data-boring-agent-part="composer-queue-preview-text"]')

      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
      await expect(page.locator('[data-boring-agent-part="session-row"]')).toHaveCount(1, { timeout: 10_000 })

      await composer.fill('harness queue stop reload initial prompt')
      await submit.click()
      await expect(page.getByTestId('chat-working')).toBeVisible({ timeout: 10_000 })

      await queueFollowUp(composer, 'harness queued survives reload then stop')
      await expect(queuePreviewText).toContainText('harness queued survives reload then stop', { timeout: 10_000 })

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/, { timeout: 10_000 })
      await expect(queuePreviewText).toContainText('harness queued survives reload then stop', { timeout: 10_000 })

      await page.getByRole('button', { name: 'Stop', exact: true }).click()
      await expect(queuePreview).toHaveCount(0, { timeout: 10_000 })
      await expect(conversation.getByText('harness queued survives reload then stop')).toHaveCount(0)

      await composer.fill('harness queue escape initial prompt')
      await submit.click()
      await expect(page.getByTestId('chat-working')).toBeVisible({ timeout: 10_000 })

      await queueFollowUp(composer, 'harness queued auto posts after escape')
      await expect(queuePreviewText).toContainText('harness queued auto posts after escape', { timeout: 10_000 })

      await composer.focus()
      await page.keyboard.press('Escape')

      await expect(conversation.getByText('harness queued auto posts after escape')).toBeVisible({ timeout: 10_000 })
      await expect(queuePreview).toHaveCount(0, { timeout: 10_000 })
      await expectQueuedFollowUpTurn(page, 'harness queued auto posts after escape')

      const summary = await page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes) => nodes.map((node) => ({
        id: node.getAttribute('data-boring-agent-message-id'),
        role: node.getAttribute('data-boring-agent-message-role'),
        status: node.getAttribute('data-boring-agent-message-status'),
        text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      })))
      await testInfo.attach('pi-native-harness-queue-stop-reload.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T6-T7',
          backend: 'scripted-pi-harness',
          messages: summary,
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

  test('keeps aborted assistant turns ordered when Escape auto-post is followed by Stop', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '250',
        BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS: '20',
      },
    })

    try {
      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

      const chat = page.locator('[data-boring-agent-part="chat"]')
      const composer = page.locator('[data-boring-agent-part="composer-input"]')
      const submit = page.locator('[data-boring-agent-part="composer-submit"]')
      const conversation = page.getByLabel('Agent conversation')
      const queuePreviewText = page.locator('[data-boring-agent-part="composer-queue-preview-text"]')

      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

      const initialPrompt = 'harness escape then stop active turn'
      const queuedPrompt = 'harness escape auto posts then stop'

      await composer.fill(initialPrompt)
      await submit.click()
      await expect(page.locator('[data-boring-agent-message-id="u1"]')).toBeVisible({ timeout: 10_000 })
      await expect(conversation.getByText(initialPrompt)).toBeVisible({ timeout: 10_000 })

      await queueFollowUp(composer, queuedPrompt)
      await expect(queuePreviewText).toContainText(queuedPrompt, { timeout: 10_000 })

      await composer.focus()
      await page.keyboard.press('Escape')
      await expect.poll(async () => {
        const state = await readChatDomState(page)
        return state.messages.slice(0, 3).map((message) => `${message.role}:${message.status}`)
      }, {
        message: 'expected Escape to abort the active turn and auto-post the queued user turn',
        timeout: 10_000,
      }).toEqual(['user:done', 'assistant:aborted', 'user:done'])
      await expect(conversation.getByText(queuedPrompt)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('chat-working')).toBeVisible({ timeout: 10_000 })
      await expect.poll(async () => {
        const state = await readChatDomState(page)
        return state.messages.slice(0, 4).map((message) => message.role)
      }, {
        message: 'expected the auto-posted queued turn assistant to start before Stop aborts it',
        timeout: 10_000,
      }).toEqual(['user', 'assistant', 'user', 'assistant'])

      await page.getByRole('button', { name: 'Stop', exact: true }).click()
      await expect.poll(async () => {
        const state = await readChatDomState(page)
        return state.messages.map((message) => `${message.role}:${message.status}`)
      }, {
        message: 'expected Stop to abort the auto-posted queued turn without reordering messages',
        timeout: 10_000,
      }).toEqual(['user:done', 'assistant:aborted', 'user:done', 'assistant:aborted'])

      const state = await readChatDomState(page)
      assertChatDomInvariants(state)

      expect(state.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
      expect(state.messages.map((message) => message.status)).toEqual(['done', 'aborted', 'done', 'aborted'])
      expect(state.messages[0]?.id).toBe('u1')
      expect(state.messages[2]?.id).toBe('u2')
      expectMessageTextOrder(state.messages.map((message) => message.text), initialPrompt, queuedPrompt)

      await testInfo.attach('pi-native-harness-queue-escape-stop-order.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T7-order',
          backend: 'scripted-pi-harness',
          messages: state.messages,
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

async function queueFollowUp(composer: Locator, text: string): Promise<void> {
  await composer.fill(text)
  await composer.press('Enter')
}

async function expectQueuedFollowUpTurn(page: Page, userText: string): Promise<void> {
  await expect.poll(async () => {
    const messages = await page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes) => nodes.map((node) => ({
      role: node.getAttribute('data-boring-agent-message-role'),
      status: node.getAttribute('data-boring-agent-message-status'),
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })))
    const userIndex = messages.findIndex((message) => message.role === 'user' && message.text.includes(userText))
    if (userIndex < 0) return false
    return messages.slice(userIndex + 1).some((message) => (
      message.role === 'assistant'
      && message.status === 'done'
      && message.text.includes('PI_NATIVE_ASSISTANT_DONE')
    ))
  }, {
    message: `expected queued follow-up "${userText}" to auto-post as the next user turn after Escape`,
    timeout: 15_000,
  }).toBe(true)
}

function expectMessageTextOrder(texts: string[], first: string, second: string): void {
  const firstIndex = texts.findIndex((text) => text.includes(first))
  const secondIndex = texts.findIndex((text) => text.includes(second))
  expect(firstIndex).toBeGreaterThanOrEqual(0)
  expect(secondIndex).toBeGreaterThan(firstIndex)
}
