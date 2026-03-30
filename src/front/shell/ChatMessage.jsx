import React from 'react'
import { User, Sparkles } from 'lucide-react'
import ToolCallCard from './ToolCallCard'

/**
 * Map a tool-invocation state to ToolCallCard status.
 */
function mapToolStatus(state) {
  switch (state) {
    case 'call':
    case 'partial-call':
      return 'running'
    case 'result':
      return 'complete'
    case 'error':
      return 'error'
    default:
      return 'running'
  }
}

/**
 * Render a single message part based on its type.
 * Returns null for protocol-only parts that should not be shown.
 */
function renderPart(part, index) {
  switch (part.type) {
    case 'text':
      return (
        <p key={index} className="vc-msg-text">
          {part.text}
        </p>
      )

    case 'reasoning':
      return (
        <div key={index} className="vc-msg-reasoning" data-part="reasoning">
          {part.reasoning}
        </div>
      )

    case 'tool-invocation': {
      const { toolInvocation } = part
      return (
        <ToolCallCard
          key={toolInvocation.toolCallId || index}
          toolName={toolInvocation.toolName}
          args={toolInvocation.args}
          result={toolInvocation.result}
          status={mapToolStatus(toolInvocation.state)}
        />
      )
    }

    // Hidden protocol parts: source, file, step-start, step-finish, etc.
    // These are not rendered in the chat timeline.
    default:
      return null
  }
}

/**
 * ChatMessage - Renders a single message in the chat timeline.
 *
 * Props:
 *   message - AI SDK UIMessage format with `parts` array
 *             { id, role: 'user'|'assistant', parts: [...] }
 */
export default function ChatMessage({ message }) {
  const isUser = message.role === 'user'
  const roleLabel = isUser ? 'You' : 'Agent'

  return (
    <div className="vc-msg">
      <div className="vc-msg-role">
        <div
          className={`vc-msg-avatar ${isUser ? 'vc-msg-avatar-user' : 'vc-msg-avatar-agent'}`}
          data-testid="chat-avatar"
        >
          {isUser ? <User size={11} /> : <Sparkles size={11} />}
        </div>
        {roleLabel}
      </div>
      <div className="vc-msg-body">
        {message.parts.map((part, i) => renderPart(part, i))}
      </div>
    </div>
  )
}
