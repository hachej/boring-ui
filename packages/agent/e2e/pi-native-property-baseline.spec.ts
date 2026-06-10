import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { assertChatDomInvariants, readChatDomState, type ChatDomState } from './helpers/chat-state'
import { formatLogs, spawnBackend } from './helpers/backend'
import { navigateBrowserToBackend } from './helpers/browser'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test.describe('Pi-native property baseline', () => {
  test('keeps chat invariants true across mixed streaming, controls, reload, stop, and Escape actions', async ({ page, workspace }, testInfo) => {
    test.setTimeout(70_000)

    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '700',
      },
    })
    const checkpoints: Array<{ action: string; state: ChatDomState }> = []

    const assertAfter = async (action: string) => {
      const state = await readChatDomState(page)
      assertChatDomInvariants(state)
      checkpoints.push({ action, state })
    }

    try {
      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

      const chat = page.locator('[data-boring-agent-part="chat"]')
      const composer = page.locator('[data-boring-agent-part="composer-input"]')
      const submit = page.locator('[data-boring-agent-part="composer-submit"]')
      const conversation = page.getByLabel('Agent conversation')
      const queuePreview = page.locator('[data-boring-agent-part="composer-queue-preview"]')
      const queuePreviewText = page.locator('[data-boring-agent-part="composer-queue-preview-text"]')

      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
      await assertAfter('initial load')

      await page.locator('[data-boring-agent-part="model-select"]').click()
      await assertAfter('open model menu')
      await page.keyboard.press('Escape')
      await assertAfter('close model menu')

      await page.locator('[data-boring-agent-part="thinking-select"]').click()
      await page.getByRole('option', { name: 'Med' }).click()
      await expect(page.locator('[data-boring-agent-part="thinking-select"]')).toHaveAttribute('aria-label', 'Thinking level: Med')
      await assertAfter('select thinking')

      await composer.fill('property baseline initial prompt')
      await submit.click()
      await expect(page.getByTestId('chat-working')).toBeVisible({ timeout: 10_000 })
      await assertAfter('submit prompt while streaming')

      await composer.fill('property queued survives reload then escape')
      await composer.press('Enter')
      await expect(queuePreviewText).toContainText('property queued survives reload then escape', { timeout: 10_000 })
      await assertAfter('queue follow-up while streaming')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
      await expect(queuePreviewText).toContainText('property queued survives reload then escape', { timeout: 10_000 })
      await assertAfter('reload while streaming with queued follow-up')

      await composer.focus()
      await page.keyboard.press('Escape')
      await expect(conversation.getByText('property queued survives reload then escape')).toBeVisible({ timeout: 10_000 })
      await expect(queuePreview).toHaveCount(0, { timeout: 10_000 })
      await assertAfter('escape auto-posts queued follow-up')
      await expect(page.getByTestId('chat-working')).toHaveCount(0, { timeout: 15_000 })
      await expectAssistantCompletionAfterUser(page, 'property queued survives reload then escape')
      await assertAfter('auto-posted follow-up settles')

      await composer.fill('property stop prompt')
      await submit.click()
      await expect(page.getByTestId('chat-working')).toBeVisible({ timeout: 10_000 })
      await assertAfter('submit second prompt')

      await composer.fill('property queued should be cleared by stop')
      await composer.press('Enter')
      await expect(queuePreviewText).toContainText('property queued should be cleared by stop', { timeout: 10_000 })
      await assertAfter('queue follow-up before stop')

      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(queuePreview).toHaveCount(0, { timeout: 10_000 })
      await expect(conversation.getByText('property queued should be cleared by stop')).toHaveCount(0)
      await assertAfter('stop clears queued follow-up')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/, { timeout: 10_000 })
      await assertAfter('final reload')

      await testInfo.attach('pi-native-property-baseline.json', {
        body: Buffer.from(JSON.stringify({
          backend: 'scripted-pi-harness',
          checkpoints,
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

async function expectAssistantCompletionAfterUser(page: Page, userText: string): Promise<void> {
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
    message: `expected an assistant completion after user message "${userText}"`,
    timeout: 15_000,
  }).toBe(true)
}
