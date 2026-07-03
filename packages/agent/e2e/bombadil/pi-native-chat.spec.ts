import {
  actions,
  always,
  eventually,
  extract,
  next,
  now,
  type Action,
  type Point,
} from '@antithesishq/bombadil'
import {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from '@antithesishq/bombadil/defaults/properties'
import { RUNNING_TOOL_GROUP_VISUAL_STATE, TOOL_GROUP_VISUAL_STATES } from '../../src/front/primitives/tool-call-group-state.ts'

const MODEL_LABEL_ORDER = ['Claude Sonnet', 'Claude Opus', 'GPT Main', 'GPT Fast'] as const
const FINAL_TEXT_SENTINELS = [
  'PI_NATIVE_ASSISTANT_DONE',
  'AUTO_POSTED_FOLLOWUP_DONE',
  'PI_NATIVE_FINAL_AFTER_RELOAD',
  'PI_NATIVE_FINAL_AFTER_REPLAY_GAP',
  'PI_NATIVE_FINAL_AFTER_CURSOR_AHEAD',
  'PI_NATIVE_FINAL_AFTER_MULTI_RESET',
] as const
const PROMPTS = [
  'bombadil baseline inspect workspace',
  'bombadil baseline check tool state',
  'bombadil baseline stream ordering',
  'bombadil baseline preserve history',
] as const
const QUEUED_FOLLOW_UPS = [
  'bombadil queued follow up one',
  'bombadil queued follow up two',
  'bombadil queued follow up three',
] as const

type ChatDomMessage = {
  id: string | null
  role: string | null
  status: string | null
  waitingFollowUp: boolean
  partOrder: string[]
  toolStates: string[]
  text: string
}

type ChatDomState = {
  connection: string | null
  sessionId: string | null
  messages: ChatDomMessage[]
  queueText: string
  modelLabels: string[]
  selectedModel: string
  thinkingLabel: string | null
  workingVisible: boolean
  submitLabel: string | null
  lastActionType: string | null
  sessionRows: Array<{ text: string; selected: boolean }>
  composerFocused: boolean
  composerValue: string
  points: {
    composer: Point | null
    submit: Point | null
    modelSelect: Point | null
    thinkingSelect: Point | null
    menuOptions: Array<{ name: string; point: Point }>
  }
}

export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
}

const chat = extract((state): ChatDomState => {
  const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const pointFor = (node: Element | null): Point | null => {
    if (!node) return null
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  }
  const partSelector = [
    '[data-boring-agent-part="message-reasoning"]',
    '[data-boring-agent-part="message-tools"]',
    '[data-boring-agent-part="message-text"]',
    '[data-boring-agent-part="message-notice"]',
  ].join(',')
  const root = state.document
  const chatRoot = root.querySelector('[data-boring-agent-part="chat"]')
  const composer = root.querySelector('[data-boring-agent-part="composer-input"]') as HTMLTextAreaElement | HTMLInputElement | null
  const itemTexts = Array.from(root.querySelectorAll('[cmdk-item]')).map((node) => text(node))
  const optionNodes = Array.from(root.querySelectorAll('[cmdk-item],[role="option"]'))
  const lastActionType = summarizeActionType(state.lastAction)

  return {
    connection: chatRoot?.getAttribute('data-pi-chat-connection') ?? null,
    sessionId: chatRoot?.getAttribute('data-pi-chat-session-id') ?? null,
    messages: Array.from(root.querySelectorAll('[data-boring-agent-part="message"]')).map((node) => ({
      id: node.getAttribute('data-boring-agent-message-id'),
      role: node.getAttribute('data-boring-agent-message-role'),
      status: node.getAttribute('data-boring-agent-message-status'),
      waitingFollowUp: Boolean(node.querySelector('[data-waiting-follow-up="true"]')),
      partOrder: Array.from(node.querySelectorAll(partSelector)).map((part) => part.getAttribute('data-boring-agent-part') ?? ''),
      toolStates: Array.from(node.querySelectorAll('[data-boring-agent-tool-state]')).map((part) => part.getAttribute('data-boring-agent-tool-state') ?? ''),
      text: text(node),
    })),
    queueText: text(root.querySelector('[data-boring-agent-part="composer-queue-preview-text"]')),
    modelLabels: itemTexts
      .map((itemText) => MODEL_LABEL_ORDER.find((label) => itemText.includes(label)) ?? null)
      .filter((label): label is typeof MODEL_LABEL_ORDER[number] => label !== null),
    selectedModel: text(root.querySelector('[data-boring-agent-part="model-select"]')),
    thinkingLabel: root.querySelector('[data-boring-agent-part="thinking-select"]')?.getAttribute('aria-label') ?? null,
    workingVisible: Boolean(root.querySelector('[data-testid="chat-working"]')),
    submitLabel: root.querySelector('[data-boring-agent-part="composer-submit"]')?.getAttribute('aria-label') ?? null,
    lastActionType,
    sessionRows: Array.from(root.querySelectorAll('[data-boring-agent-part="session-row"]')).map((node) => ({
      text: text(node),
      selected: node.getAttribute('data-boring-state') === 'selected',
    })),
    composerFocused: state.document.activeElement === composer,
    composerValue: composer?.value ?? '',
    points: {
      composer: pointFor(composer),
      submit: pointFor(root.querySelector('[data-boring-agent-part="composer-submit"]')),
      modelSelect: pointFor(root.querySelector('[data-boring-agent-part="model-select"]')),
      thinkingSelect: pointFor(root.querySelector('[data-boring-agent-part="thinking-select"]')),
      menuOptions: optionNodes
        .map((node) => ({ name: text(node), point: pointFor(node) }))
        .filter((entry): entry is { name: string; point: Point } => Boolean(entry.point)),
    },
  }
})

export const chat_has_unique_message_ids = always(() => {
  const ids = chat.current.messages.map((message) => message.id).filter((id): id is string => Boolean(id))
  return new Set(ids).size === ids.length
})

export const chat_has_at_most_one_selected_session = always(() => (
  chat.current.sessionRows.filter((row) => row.selected).length <= 1
))

export const assistant_parts_stay_ordered = always(() => (
  chat.current.messages
    .filter((message) => message.role === 'assistant')
    .every((message) => isStableAssistantPartOrder(message.partOrder))
))

export const assistant_final_text_is_not_duplicated = always(() => (
  chat.current.messages
    .filter((message) => message.role === 'assistant')
    .every((message) => FINAL_TEXT_SENTINELS.every((sentinel) => countOccurrences(message.text, sentinel) <= 1))
))

export const tool_group_visual_states_are_known = always(() => (
  chat.current.messages.every((message) => (
    message.toolStates.every((state) => TOOL_GROUP_VISUAL_STATES.includes(state as typeof TOOL_GROUP_VISUAL_STATES[number]))
  ))
))

export const idle_chat_has_no_running_tool_groups = always(() => (
  chat.current.workingVisible
  || chat.current.messages.every((message) => !message.toolStates.includes(RUNNING_TOOL_GROUP_VISUAL_STATE))
))

export const busy_state_matches_submit_control = always(() => (
  !chat.current.workingVisible || chat.current.submitLabel === 'Stop'
))

export const deterministic_model_order_is_stable = always(() => (
  chat.current.modelLabels.length === 0 || arraysEqual(chat.current.modelLabels, [...MODEL_LABEL_ORDER])
))

export const reset_fixture_stale_text_never_renders = always(() => (
  chat.current.messages.every((message) => !message.text.includes('SHOULD_NOT_RENDER'))
))

export const queued_follow_ups_are_visibly_marked = always(() => (
  chat.current.messages.every((message) => {
    if (message.id?.startsWith('queue:')) {
      return message.waitingFollowUp && message.role === 'user' && message.status === 'pending'
    }
    if (!message.waitingFollowUp) return true
    return message.role === 'user' && message.status === 'pending'
  })
))

export const connected_reset_never_empties_existing_transcript = always(
  now(() => {
    const previousSessionId = chat.current.sessionId
    const previousMessageIds = visibleMessageIds()
    return next(() => {
      if (previousMessageIds.length === 0) return true
      if (chat.current.connection !== 'connected') return true
      if (previousSessionId && chat.current.sessionId && chat.current.sessionId !== previousSessionId) return true
      return chat.current.messages.length > 0
    })
  }),
)

export const reload_does_not_drop_queued_follow_up = always(
  now(() => {
    const queuedText = extractKnownQueuedText(chat.current.queueText)
    const previousSessionId = chat.current.sessionId
    return next(() => {
      if (!queuedText) return true
      if (chat.current.lastActionType !== 'Reload') return true
      return eventually(() => {
        if (chat.current.connection !== 'connected') return false
        if (previousSessionId && chat.current.sessionId && chat.current.sessionId !== previousSessionId) return true
        return chat.current.queueText.includes(queuedText)
          || chat.current.messages.some((message) => message.text.includes(queuedText))
      }).within(10, 'seconds')
    })
  }),
)

export const surviving_message_order_is_stable = always(
  now(() => {
    const previousIds = visibleMessageIds()
    return next(() => {
      const nextIds = visibleMessageIds()
      return survivingOrderStable(previousIds, nextIds)
    })
  }),
)

export const chatActions = actions((): Action[] => {
  const current = chat.current
  const generated: Action[] = ['Wait', 'Reload']

  if (current.points.composer) {
    generated.push({ Click: { name: 'composer', point: current.points.composer } })
  }

  if (current.composerFocused) {
    for (const text of current.workingVisible ? QUEUED_FOLLOW_UPS : PROMPTS) {
      generated.push({ TypeText: { text, delayMillis: 0 } })
    }
    if (current.composerValue.trim().length > 0) generated.push({ PressKey: { code: 13 } }, { PressKey: { code: 13 } })
  }

  if (current.points.submit && (current.workingVisible || current.composerValue.trim().length > 0)) {
    const submitAction: Action = { Click: { name: current.workingVisible ? 'stop' : 'submit', point: current.points.submit } }
    generated.push(submitAction)
    if (!current.workingVisible) generated.push(submitAction)
  }

  if (current.workingVisible) {
    generated.push({ PressKey: { code: 27 } })
  }

  if (current.points.modelSelect) {
    generated.push({ Click: { name: 'model-select', point: current.points.modelSelect } })
  }
  if (current.points.thinkingSelect) {
    generated.push({ Click: { name: 'thinking-select', point: current.points.thinkingSelect } })
  }
  for (const option of current.points.menuOptions.slice(0, 8)) {
    generated.push({ Click: { name: option.name || 'menu-option', content: option.name, point: option.point } })
  }

  appendResetFocusedActions(generated, current)

  return generated
})

function appendResetFocusedActions(generated: Action[], current: ChatDomState): void {
  if (current.workingVisible || current.queueText.length > 0) {
    generated.push('Reload', 'Reload')
  } else if (current.messages.length > 0) {
    generated.push('Reload')
  }

  if (current.workingVisible) {
    generated.push('Reload', { PressKey: { code: 27 } }, { PressKey: { code: 27 } })
    if (current.points.submit) {
      generated.push({ Click: { name: 'stop-reset-focused', point: current.points.submit } })
    }
  }

  if (current.queueText.length > 0) {
    generated.push('Reload', 'Wait')
  }
}

function visibleMessageIds(): string[] {
  return chat.current.messages.map((message) => message.id).filter((id): id is string => Boolean(id))
}

function summarizeActionType(action: Action | null): string | null {
  if (!action) return null
  if (typeof action === 'string') return action
  if ('Click' in action) return 'Click'
  if ('DoubleClick' in action) return 'DoubleClick'
  if ('TypeText' in action) return 'TypeText'
  if ('PressKey' in action) return 'PressKey'
  if ('ScrollUp' in action) return 'ScrollUp'
  if ('ScrollDown' in action) return 'ScrollDown'
  if ('SetFileInputFiles' in action) return 'SetFileInputFiles'
  return null
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
    const nextOrder = order.get(part)
    if (nextOrder === undefined) continue
    if (nextOrder < last) return false
    last = nextOrder
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

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function survivingOrderStable(previousIds: string[], nextIds: string[]): boolean {
  const nextIndexById = new Map(nextIds.map((id, index) => [id, index]))
  const survivingIndexes = previousIds
    .map((id) => nextIndexById.get(id))
    .filter((index): index is number => index !== undefined)
  return survivingIndexes.every((index, position) => position === 0 || index >= survivingIndexes[position - 1]!)
}

function extractKnownQueuedText(queueText: string): string | null {
  for (const queuedText of QUEUED_FOLLOW_UPS) {
    if (queueText.includes(queuedText)) return queuedText
  }
  return null
}
