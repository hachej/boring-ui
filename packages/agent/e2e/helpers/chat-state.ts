import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { RUNNING_TOOL_GROUP_VISUAL_STATE, TOOL_GROUP_VISUAL_STATES } from '../../src/front/primitives/tool-call-group-state'

export const MODEL_LABEL_ORDER = ['Claude Sonnet', 'Claude Opus', 'GPT Main', 'GPT Fast'] as const
const FINAL_TEXT_SENTINELS = [
  'PI_NATIVE_ASSISTANT_DONE',
  'AUTO_POSTED_FOLLOWUP_DONE',
  'PI_NATIVE_FINAL_AFTER_RELOAD',
  'PI_NATIVE_FINAL_AFTER_REPLAY_GAP',
  'PI_NATIVE_FINAL_AFTER_CURSOR_AHEAD',
  'PI_NATIVE_FINAL_AFTER_MULTI_RESET',
  'LATE_FINAL_AFTER_ABORT',
] as const

export interface ChatDomMessage {
  id: string | null
  role: string | null
  status: string | null
  waitingFollowUp: boolean
  partOrder: string[]
  toolStates: string[]
  text: string
}

export interface ChatDomState {
  connection: string | null
  sessionId: string | null
  messages: ChatDomMessage[]
  queueText: string
  modelLabels: string[]
  selectedModel: string
  thinkingLabel: string | null
  workingVisible: boolean
  submitLabel: string | null
  sessionRows: Array<{ text: string; selected: boolean }>
  composerFocused: boolean
  composerValue: string
}

export async function readChatDomState(page: Page): Promise<ChatDomState> {
  return page.evaluate((modelLabelOrder) => {
    const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const chat = document.querySelector('[data-boring-agent-part="chat"]')
    const composer = document.querySelector('[data-boring-agent-part="composer-input"]') as HTMLTextAreaElement | HTMLInputElement | null
    const partSelector = [
      '[data-boring-agent-part="message-reasoning"]',
      '[data-boring-agent-part="message-tools"]',
      '[data-boring-agent-part="message-text"]',
      '[data-boring-agent-part="message-notice"]',
    ].join(',')

    const itemTexts = Array.from(document.querySelectorAll('[cmdk-item]')).map((node) => text(node))

    return {
      connection: chat?.getAttribute('data-pi-chat-connection') ?? null,
      sessionId: chat?.getAttribute('data-pi-chat-session-id') ?? null,
      messages: Array.from(document.querySelectorAll('[data-boring-agent-part="message"]')).map((node) => ({
        id: node.getAttribute('data-boring-agent-message-id'),
        role: node.getAttribute('data-boring-agent-message-role'),
        status: node.getAttribute('data-boring-agent-message-status'),
        waitingFollowUp: Boolean(node.querySelector('[data-waiting-follow-up="true"]')),
        partOrder: Array.from(node.querySelectorAll(partSelector)).map((part) => part.getAttribute('data-boring-agent-part') ?? ''),
        toolStates: Array.from(node.querySelectorAll('[data-boring-agent-tool-state]')).map((part) => part.getAttribute('data-boring-agent-tool-state') ?? ''),
        text: text(node),
      })),
      queueText: text(document.querySelector('[data-boring-agent-part="composer-queue-preview-text"]')),
      modelLabels: itemTexts
        .map((itemText) => modelLabelOrder.find((label) => itemText.includes(label)) ?? null)
        .filter((label): label is typeof modelLabelOrder[number] => label !== null),
      selectedModel: text(document.querySelector('[data-boring-agent-part="model-select"]')),
      thinkingLabel: document.querySelector('[data-boring-agent-part="thinking-select"]')?.getAttribute('aria-label') ?? null,
      workingVisible: Boolean(document.querySelector('[data-testid="chat-working"]')),
      submitLabel: document.querySelector('[data-boring-agent-part="composer-submit"]')?.getAttribute('aria-label') ?? null,
      sessionRows: Array.from(document.querySelectorAll('[data-boring-agent-part="session-row"]')).map((node) => ({
        text: text(node),
        selected: node.getAttribute('data-boring-state') === 'selected',
      })),
      composerFocused: document.activeElement === composer,
      composerValue: composer?.value ?? '',
    }
  }, [...MODEL_LABEL_ORDER])
}

export function assertChatDomInvariants(state: ChatDomState): void {
  const messageIds = state.messages.map((message) => message.id).filter((id): id is string => Boolean(id))
  expect(new Set(messageIds).size, 'displayed message ids must be unique').toBe(messageIds.length)

  expect(state.sessionRows.filter((row) => row.selected).length, 'only one session row may be selected').toBeLessThanOrEqual(1)

  for (const message of state.messages) {
    if (message.id?.startsWith('queue:')) {
      expect(message.waitingFollowUp, `queued follow-up ${message.id} must be visually marked as waiting`).toBe(true)
    }
    if (message.waitingFollowUp) {
      expect(message.role, `waiting follow-up ${message.id ?? '<missing id>'} must render as a user row`).toBe('user')
      expect(message.status, `waiting follow-up ${message.id ?? '<missing id>'} must stay pending`).toBe('pending')
    }

    if (message.role === 'assistant') {
      expect(isStableAssistantPartOrder(message.partOrder), `assistant parts must stay ordered for ${message.id ?? '<missing id>'}`).toBe(true)
      for (const toolState of message.toolStates) {
        expect(TOOL_GROUP_VISUAL_STATES, `tool group visual state must be known for ${message.id ?? '<missing id>'}`).toContain(toolState)
      }
      if (!state.workingVisible) {
        expect(message.toolStates, `idle chat must not leave a running tool group in ${message.id ?? '<missing id>'}`).not.toContain(RUNNING_TOOL_GROUP_VISUAL_STATE)
      }
      for (const sentinel of FINAL_TEXT_SENTINELS) {
        expect(countOccurrences(message.text, sentinel), `final text ${sentinel} must not repeat in ${message.id ?? '<missing id>'}`).toBeLessThanOrEqual(1)
      }
    }
  }

  if (state.workingVisible) {
    expect(state.submitLabel, 'busy indicator and submit control must agree').toBe('Stop')
  }

  if (state.modelLabels.length > 0) {
    expect(state.modelLabels, 'model menu order must stay stable').toEqual([...MODEL_LABEL_ORDER])
  }
}

function isStableAssistantPartOrder(parts: string[]): boolean {
  const order = new Map([
    ['message-reasoning', 0],
    ['message-tools', 1],
    ['message-text', 2],
    ['message-notice', 3],
  ])
  let last = -1
  for (const part of parts) {
    const next = order.get(part)
    if (next === undefined) continue
    if (next < last) return false
    last = next
  }
  return true
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
