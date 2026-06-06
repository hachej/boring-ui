import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { assertChatDomInvariants, readChatDomState } from './helpers/chat-state'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

const LONG_TRANSCRIPT_TURNS = 48

interface MessageSummary {
  id: string | null
  role: string | null
  status: string | null
  partTypes: string[]
}

test.describe('Pi-native long transcript reload', () => {
  test('reload keeps the full visible transcript, stable ids, and chronological order', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript((turnCount) => {
      const pad = (value: number) => String(value).padStart(3, '0')
      const messages = Array.from({ length: turnCount }, (_, index) => {
        const turn = index + 1
        const label = pad(turn)
        const userId = `long-u-${label}`
        const assistantId = `long-a-${label}`
        return [
          {
            id: userId,
            role: 'user',
            status: 'done',
            parts: [{ type: 'text', id: `${userId}:text`, text: `<redacted long prompt ${label}>` }],
          },
          {
            id: assistantId,
            role: 'assistant',
            status: 'done',
            parts: [{ type: 'text', id: `${assistantId}:text`, text: `LONG_ASSISTANT_${label}` }],
          },
        ]
      }).flat()

      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: turnCount * 2,
        status: 'idle',
        messages,
        queue: { followUps: [] },
        prompts: [],
        followups: [],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
        sessions: [
          {
            id: 'pi-e2e',
            title: 'Long transcript baseline',
            createdAt: '2026-06-03T00:00:00.000Z',
            updatedAt: '2026-06-04T00:00:00.000Z',
            turnCount,
          },
        ],
      }))
    }, LONG_TRANSCRIPT_TURNS)

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const conversation = page.getByLabel('Agent conversation')
    const messageRows = page.locator('[data-boring-agent-part="message"]')
    const expectedMessages = LONG_TRANSCRIPT_TURNS * 2

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(messageRows).toHaveCount(expectedMessages, { timeout: 10_000 })
    await expect(conversation.getByText('LONG_ASSISTANT_001')).toBeVisible()
    await expect(conversation.getByText('LONG_ASSISTANT_024')).toBeVisible()
    await expect(conversation.getByText('LONG_ASSISTANT_048')).toBeVisible()

    const before = await readMessageSummary(page)
    assertLongTranscriptSummary(before)
    assertChatDomInvariants(await readChatDomState(page))

    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(messageRows).toHaveCount(expectedMessages, { timeout: 10_000 })
    await expect(conversation.getByText('LONG_ASSISTANT_001')).toBeVisible()
    await expect(conversation.getByText('LONG_ASSISTANT_024')).toBeVisible()
    await expect(conversation.getByText('LONG_ASSISTANT_048')).toBeVisible()

    const after = await readMessageSummary(page)
    assertLongTranscriptSummary(after)
    assertChatDomInvariants(await readChatDomState(page))
    expect(after.map((message) => message.id)).toEqual(before.map((message) => message.id))
    expect(after.map((message) => message.role)).toEqual(before.map((message) => message.role))
    expect(after.map((message) => message.partTypes)).toEqual(before.map((message) => message.partTypes))

    await testInfo.attach('pi-native-long-transcript-reload.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'long-transcript-reload',
        turnCount: LONG_TRANSCRIPT_TURNS,
        before,
        after,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })
})

async function readMessageSummary(page: Page): Promise<MessageSummary[]> {
  return page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes: Element[]) => nodes.map((node) => ({
    id: node.getAttribute('data-boring-agent-message-id'),
    role: node.getAttribute('data-boring-agent-message-role'),
    status: node.getAttribute('data-boring-agent-message-status'),
    partTypes: Array.from(node.querySelectorAll('[data-boring-agent-part]'))
      .map((part) => part.getAttribute('data-boring-agent-part'))
      .filter((part): part is string => part === 'message-text' || part === 'message-reasoning' || part === 'message-tools' || part === 'message-notice'),
  })))
}

function assertLongTranscriptSummary(messages: MessageSummary[]): void {
  expect(messages).toHaveLength(LONG_TRANSCRIPT_TURNS * 2)
  expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length)

  messages.forEach((message, index) => {
    const turn = Math.floor(index / 2) + 1
    const label = String(turn).padStart(3, '0')
    if (index % 2 === 0) {
      expect(message).toMatchObject({ id: `long-u-${label}`, role: 'user', status: 'done' })
    } else {
      expect(message).toMatchObject({ id: `long-a-${label}`, role: 'assistant', status: 'done' })
      expect(message.partTypes).toEqual(['message-text'])
    }
  })
}
