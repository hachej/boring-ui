import type { BoringChatMessage, QueuedUserMessage } from '../../../shared/chat'
import type { PiChatRuntimeNotice, PiChatState } from './piChatReducer'

export function selectMessagesForRender(state: PiChatState): BoringChatMessage[] {
  const messages = [...state.committedMessages]
  for (const optimistic of Object.values(state.optimisticOutbox)) {
    if (!messages.some((message) => message.clientNonce === optimistic.clientNonce)) {
      messages.push(optimistic)
    }
  }
  if (state.streamingMessage && !messages.some((message) => message.id === state.streamingMessage?.id)) {
    messages.push(state.streamingMessage)
  }
  return messages
}

export function selectQueuePreview(state: PiChatState): QueuedUserMessage[] {
  return state.queue.followUps
}

export function selectRuntimeNotices(state: PiChatState): PiChatRuntimeNotice[] {
  const notices = [...state.notices]
  if (state.connection.state === 'reconnecting') {
    notices.push({ id: 'connection-reconnecting', level: 'warning', text: 'Reconnecting to the agent session…' })
  }
  if (state.retryNotice) {
    notices.push({
      id: 'auto-retry',
      level: 'info',
      text: `Retrying agent request (${state.retryNotice.attempt}/${state.retryNotice.maxAttempts})…`,
    })
  }
  if (state.error && !notices.some((notice) => notice.id.startsWith('turn-error:') || notice.id === 'protocol-error')) {
    notices.push({ id: 'chat-error', level: 'error', text: state.error.message, dismissible: true })
  }
  return notices
}

export function selectIsEmptyTimeline(state: PiChatState): boolean {
  return selectMessagesForRender(state).length === 0
}

export function selectHasPendingOutbox(state: PiChatState): boolean {
  return Object.keys(state.optimisticOutbox).length > 0
}
