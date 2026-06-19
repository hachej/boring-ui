import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { formatLogs, spawnBackend } from './helpers/backend'
import { navigateBrowserToBackend } from './helpers/browser'
import { assertChatDomInvariants, readChatDomState, type ChatDomState } from './helpers/chat-state'

interface MessageSummary {
  id: string | null
  role: string | null
  status: string | null
  text: string
  reasoningCount: number
  toolGroupCount: number
  textPartCount: number
  partOrder: string[]
}

interface TimelineTraceFrame {
  label: string
  workingVisible: boolean
  submitLabel: string | null
  messages: Array<{
    id: string | null
    role: string | null
    status: string | null
    partOrder: string[]
    toolStates: string[]
    hasReasoning: boolean
    hasFinalText: boolean
  }>
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test.describe('Pi-native harness-backed baseline message flow', () => {
  test('drives chat through server routes, scripted Pi adapter events, reducer, and renderer', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '250',
        BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS: '16',
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

      await composer.fill('baseline inspect workspace')
      await page.locator('[data-boring-agent-part="composer-submit"]').click()

      const timelineTrace: TimelineTraceFrame[] = []
      timelineTrace.push(await waitForTimelineFrame(page, 'user accepted before assistant starts', (state) => {
        return state.workingVisible
          && state.messages.length === 1
          && state.messages[0]?.role === 'user'
          && state.messages[0]?.status === 'done'
      }))
      timelineTrace.push(await waitForTimelineFrame(page, 'assistant reasoning streams in one message', (state) => {
        const assistant = assistantMessage(state)
        return state.workingVisible
          && state.messages.map((message) => message.role).join(',') === 'user,assistant'
          && assistant?.status === 'streaming'
          && assistant.partOrder.join(',') === 'message-reasoning'
          && assistant.toolStates.length === 0
          && !assistant.text.includes('PI_NATIVE_ASSISTANT_DONE')
      }))
      timelineTrace.push(await waitForTimelineFrame(page, 'same assistant shows one running tool group before final text', (state) => {
        const assistant = assistantMessage(state)
        return state.workingVisible
          && state.messages.map((message) => message.role).join(',') === 'user,assistant'
          && assistant?.status === 'streaming'
          && assistant.partOrder.join(',') === 'message-reasoning,message-tools'
          && assistant.toolStates.join(',') === 'running'
          && !assistant.text.includes('PI_NATIVE_ASSISTANT_DONE')
      }))

      await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('chat-working')).toHaveCount(0, { timeout: 10_000 })

      timelineTrace.push(await waitForTimelineFrame(page, 'same assistant settles tool group then final text', (state) => {
        const assistant = assistantMessage(state)
        return !state.workingVisible
          && state.messages.map((message) => message.role).join(',') === 'user,assistant'
          && assistant?.status === 'done'
          && assistant.partOrder.join(',') === 'message-reasoning,message-tools,message-text'
          && assistant.toolStates.join(',') === 'settled'
          && countOccurrences(assistant.text, 'PI_NATIVE_ASSISTANT_DONE') === 1
      }))

      const summary = await readMessageSummary(page)
      await testInfo.attach('pi-native-harness-baseline-message-flow.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T5',
          backend: 'scripted-pi-harness',
          messages: summary,
          timelineTrace,
        }, null, 2), 'utf8'),
        contentType: 'application/json',
      })

      expect(summary).toHaveLength(2)
      expect(new Set(summary.map((message) => message.id)).size).toBe(summary.length)
      expect(summary.map((message) => message.role)).toEqual(['user', 'assistant'])

      const assistant = summary[1]
      expect(assistant?.reasoningCount).toBe(1)
      expect(assistant?.toolGroupCount).toBe(1)
      expect(assistant?.textPartCount).toBe(1)
      expect(assistant?.partOrder).toEqual([
        'message-reasoning',
        'message-tools',
        'message-text',
      ])
      expect(countOccurrences(assistant?.text ?? '', 'PI_NATIVE_ASSISTANT_DONE')).toBe(1)
      expect(assistant?.text).toMatch(/Used search|grep/i)

      const assistantIds = timelineTrace
        .flatMap((frame) => frame.messages)
        .filter((message) => message.role === 'assistant')
        .map((message) => message.id)
      expect(assistantIds.every(Boolean)).toBe(true)
      expect(new Set(assistantIds).size).toBe(1)
      expect(timelineTrace.map((frame) => frame.messages.map((message) => message.role))).toEqual([
        ['user'],
        ['user', 'assistant'],
        ['user', 'assistant'],
        ['user', 'assistant'],
      ])
      expect(timelineTrace.map((frame) => assistantTrace(frame)?.partOrder ?? [])).toEqual([
        [],
        ['message-reasoning'],
        ['message-reasoning', 'message-tools'],
        ['message-reasoning', 'message-tools', 'message-text'],
      ])
      expect(assistantTrace(timelineTrace[2])?.toolStates).toEqual(['running'])
      expect(assistantTrace(timelineTrace[3])?.toolStates).toEqual(['settled'])
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

  test('keeps completed previous turns ordered while the next assistant streams', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS: '300',
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
      const submit = page.locator('[data-boring-agent-part="composer-submit"]')

      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

      await composer.fill('baseline first completed turn')
      await submit.click()

      const firstSettled = await waitForTimelineFrame(page, 'first turn settles before second prompt', (state) => {
        const assistant = assistantMessages(state)[0]
        return !state.workingVisible
          && state.submitLabel !== 'Stop'
          && state.messages.map((message) => message.role).join(',') === 'user,assistant'
          && state.messages.map((message) => message.id).join(',') === 'u1,a1'
          && assistant?.status === 'done'
          && assistant.toolStates.join(',') === 'settled'
          && countOccurrences(assistant.text, 'PI_NATIVE_ASSISTANT_DONE') === 1
      })
      const firstTurnIds = firstSettled.messages.map((message) => message.id)

      await composer.fill('baseline second turn streams after previous')
      await submit.click()

      const secondUserAccepted = await waitForTimelineFrame(page, 'second user appends after first settled turn', (state) => {
        return state.workingVisible
          && state.messages.length >= 3
          && state.messages.slice(0, 3).map((message) => message.role).join(',') === 'user,assistant,user'
          && state.messages.slice(0, 2).map((message) => message.id).join(',') === firstTurnIds.join(',')
          && state.messages[2]?.id === 'u2'
      })
      const secondRunning = await waitForTimelineFrame(page, 'second assistant streams after previous turn without reordering it', (state) => {
        const assistants = assistantMessages(state)
        const firstAssistant = assistants[0]
        const secondAssistant = assistants[1]
        return state.workingVisible
          && state.messages.map((message) => message.role).join(',') === 'user,assistant,user,assistant'
          && state.messages.slice(0, 2).map((message) => message.id).join(',') === firstTurnIds.join(',')
          && state.messages.map((message) => message.id).join(',') === 'u1,a1,u2,a2'
          && firstAssistant?.status === 'done'
          && countOccurrences(firstAssistant.text, 'PI_NATIVE_ASSISTANT_DONE') === 1
          && secondAssistant?.status === 'streaming'
          && secondAssistant.partOrder.join(',') === 'message-reasoning,message-tools'
          && secondAssistant.toolStates.join(',') === 'running'
          && !secondAssistant.text.includes('PI_NATIVE_ASSISTANT_DONE')
      })

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

      const secondRunningAfterReload = await waitForTimelineFrame(page, 'active reload keeps previous completed turn before the running turn', (state) => {
        const assistants = assistantMessages(state)
        const firstAssistant = assistants[0]
        const secondAssistant = assistants[1]
        return state.workingVisible
          && state.messages.map((message) => message.role).join(',') === 'user,assistant,user,assistant'
          && state.messages.slice(0, 2).map((message) => message.id).join(',') === firstTurnIds.join(',')
          && state.messages.map((message) => message.id).join(',') === 'u1,a1,u2,a2'
          && firstAssistant?.status === 'done'
          && firstAssistant.toolStates.join(',') === 'settled'
          && countOccurrences(firstAssistant.text, 'PI_NATIVE_ASSISTANT_DONE') === 1
          && secondAssistant?.status === 'streaming'
          && secondAssistant.partOrder.join(',') === 'message-reasoning,message-tools'
          && secondAssistant.toolStates.join(',') === 'running'
          && !secondAssistant.text.includes('PI_NATIVE_ASSISTANT_DONE')
      })

      const secondSettled = await waitForTimelineFrame(page, 'second assistant settles after previous turn remains unchanged', (state) => {
        const assistants = assistantMessages(state)
        const firstAssistant = assistants[0]
        const secondAssistant = assistants[1]
        return !state.workingVisible
          && state.messages.map((message) => message.role).join(',') === 'user,assistant,user,assistant'
          && state.messages.slice(0, 2).map((message) => message.id).join(',') === firstTurnIds.join(',')
          && state.messages.map((message) => message.id).join(',') === 'u1,a1,u2,a2'
          && firstAssistant?.status === 'done'
          && firstAssistant.toolStates.join(',') === 'settled'
          && countOccurrences(firstAssistant.text, 'PI_NATIVE_ASSISTANT_DONE') === 1
          && secondAssistant?.status === 'done'
          && secondAssistant.partOrder.join(',') === 'message-reasoning,message-tools,message-text'
          && secondAssistant.toolStates.join(',') === 'settled'
          && countOccurrences(secondAssistant.text, 'PI_NATIVE_ASSISTANT_DONE') === 1
      })

      const finalState = await readChatDomState(page)
      assertChatDomInvariants(finalState)
      expect(finalState.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
      expect(finalState.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
      expect(new Set(finalState.messages.map((message) => message.id)).size).toBe(4)

      await testInfo.attach('pi-native-harness-multi-turn-ordering.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'T5-multi-turn-ordering',
          backend: 'scripted-pi-harness',
          frames: [firstSettled, secondUserAccepted, secondRunning, secondRunningAfterReload, secondSettled],
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

async function waitForTimelineFrame(
  page: Page,
  label: string,
  predicate: (state: ChatDomState) => boolean,
): Promise<TimelineTraceFrame> {
  const startedAt = Date.now()
  let lastFrame: TimelineTraceFrame | undefined
  while (Date.now() - startedAt < 10_000) {
    const state = await readChatDomState(page)
    assertChatDomInvariants(state)
    lastFrame = summarizeTimelineFrame(label, state)
    if (predicate(state)) return lastFrame
    await page.waitForTimeout(50)
  }
  throw new Error(`Timed out waiting for timeline frame "${label}". Last frame: ${JSON.stringify(lastFrame, null, 2)}`)
}

function summarizeTimelineFrame(label: string, state: ChatDomState): TimelineTraceFrame {
  return {
    label,
    workingVisible: state.workingVisible,
    submitLabel: state.submitLabel,
    messages: state.messages.map((message) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      partOrder: message.partOrder,
      toolStates: message.toolStates,
      hasReasoning: message.partOrder.includes('message-reasoning'),
      hasFinalText: message.text.includes('PI_NATIVE_ASSISTANT_DONE'),
    })),
  }
}

function assistantMessage(state: ChatDomState) {
  return state.messages.find((message) => message.role === 'assistant')
}

function assistantMessages(state: ChatDomState) {
  return state.messages.filter((message) => message.role === 'assistant')
}

function assistantTrace(frame: TimelineTraceFrame | undefined) {
  return frame?.messages.find((message) => message.role === 'assistant')
}

async function readMessageSummary(page: Page): Promise<MessageSummary[]> {
  return page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes: Element[]) =>
    nodes.map((node) => ({
      id: node.getAttribute('data-boring-agent-message-id'),
      role: node.getAttribute('data-boring-agent-message-role'),
      status: node.getAttribute('data-boring-agent-message-status'),
      text: node.getAttribute('data-boring-agent-message-role') === 'user'
        ? '<redacted user prompt>'
        : node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      reasoningCount: node.querySelectorAll('[data-boring-agent-part="message-reasoning"]').length,
      toolGroupCount: node.querySelectorAll('[data-boring-agent-part="message-tools"]').length,
      textPartCount: node.querySelectorAll('[data-boring-agent-part="message-text"]').length,
      partOrder: Array.from(node.querySelectorAll(
        [
          '[data-boring-agent-part="message-reasoning"]',
          '[data-boring-agent-part="message-tools"]',
          '[data-boring-agent-part="message-text"]',
          '[data-boring-agent-part="message-notice"]',
        ].join(','),
      )).map((part) => part.getAttribute('data-boring-agent-part') ?? ''),
    })),
  )
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
