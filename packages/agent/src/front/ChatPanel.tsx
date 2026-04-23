import type { UIMessage } from 'ai'
import { isToolUIPart, getToolName } from 'ai'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { UiBridge } from '../shared/ui-bridge'
import './styles/theme.css'
import { Composer, type ComposerHandle, type ComposerSendInput } from './components/Composer'
import { isModelId } from './components/ModelPicker'
import { useAgentChat } from './hooks/useAgentChat'
import { CodeBlock } from './primitives/CodeBlock'
import { Message, MessagePartContainer } from './primitives/Message'
import { Reasoning } from './primitives/Reasoning'
import { builtinCommands } from './slashCommands/builtins'
import { parseSlashCommand } from './slashCommands/parser'
import { createCommandRegistry, type SlashCommand, type SlashCommandContext } from './slashCommands/registry'
import {
  mergeToolRenderers,
  resolveToolRenderer,
  type ToolPart,
  type ToolRendererOverrides,
} from './toolRenderers'

export interface ChatPanelProps {
  sessionId: string
  bridge?: UiBridge
  toolRenderers?: ToolRendererOverrides
  extraCommands?: SlashCommand[]
  onSessionReset?: () => void | Promise<void>
}

function isTextPart(part: UIMessage['parts'][number]): part is Extract<UIMessage['parts'][number], { type: 'text' }> {
  return part.type === 'text'
}

interface ReasoningPartView {
  text: string
  state: 'streaming' | 'done'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

function getReasoningPart(part: UIMessage['parts'][number]): ReasoningPartView | null {
  const record = asRecord(part)
  if (!record || record.type !== 'reasoning') {
    return null
  }

  const textCandidate = record.text ?? record.content
  if (typeof textCandidate !== 'string' || textCandidate.length === 0) {
    return null
  }

  const stateCandidate = record.state
  return {
    text: textCandidate,
    state: stateCandidate === 'streaming' ? 'streaming' : 'done',
  }
}

function getToolParts(message: UIMessage): Array<UIMessage['parts'][number]> {
  return message.parts.filter(isToolUIPart)
}

function roleForMessage(message: UIMessage): 'user' | 'assistant' | 'system' {
  if (message.role === 'user' || message.role === 'assistant' || message.role === 'system') {
    return message.role
  }
  return 'assistant'
}

function renderTextWithCodeBlocks(text: string): ReactNode {
  const blockPattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g
  const chunks: ReactNode[] = []
  let lastIndex = 0
  let match = blockPattern.exec(text)

  while (match) {
    const [full, language, code] = match
    const before = text.slice(lastIndex, match.index)
    if (before.length > 0) {
      chunks.push(
        <div key={`text-${lastIndex}`} className="boring-chat__text">
          {before}
        </div>,
      )
    }

    chunks.push(
      <CodeBlock
        key={`code-${match.index}`}
        code={code}
        language={language || undefined}
      />,
    )

    lastIndex = match.index + full.length
    match = blockPattern.exec(text)
  }

  const trailing = text.slice(lastIndex)
  if (trailing.length > 0 || chunks.length === 0) {
    chunks.push(
      <div key={`text-${lastIndex}-tail`} className="boring-chat__text">
        {trailing}
      </div>,
    )
  }

  return chunks
}

function statusText(status: string): string | null {
  if (status === 'submitted') return 'Thinking…'
  if (status === 'streaming') return 'Generating…'
  return null
}

export function ChatPanel(props: ChatPanelProps) {
  const { sessionId, toolRenderers, extraCommands, onSessionReset } = props
  const { messages, sendMessage, setMessages, status, error } = useAgentChat({ sessionId })
  const mergedToolRenderers = mergeToolRenderers(toolRenderers)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  const registry = useMemo(
    () => createCommandRegistry([...builtinCommands, ...(extraCommands ?? [])]),
    [extraCommands],
  )

  const isStreaming = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  async function handleSend(input: ComposerSendInput): Promise<void> {
    const parsed = parseSlashCommand(input.message)
    if (parsed) {
      const cmd = registry.get(parsed.name)
      if (cmd) {
        const ctx: SlashCommandContext = {
          sessionId,
          clearMessages: () => setMessages([]),
          resetSession: () => {
            setMessages([])
            fetch(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => {})
            void onSessionReset?.()
          },
          setModel: (model) => {
            if (!isModelId(model)) return false
            try { globalThis.localStorage?.setItem('boring-agent:composer:model', model) } catch {}
            globalThis.dispatchEvent?.(new CustomEvent('boring:model-change', { detail: model }))
            return true
          },
          listCommands: () => registry.list(),
        }
        const result = cmd.handler(parsed.args, ctx)
        if (typeof result === 'string') {
          setMessages((prev) => [
            ...prev,
            {
              id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
              role: 'assistant' as const,
              content: result,
              parts: [{ type: 'text' as const, text: result }],
            },
          ])
        }
        return
      }
    }

    await sendMessage(
      { text: input.message },
      {
        body: {
          sessionId,
          message: input.message,
          model: input.model,
          thinkingLevel: input.thinkingLevel,
        },
      },
    )
    composerRef.current?.focus()
  }

  return (
    <div
      data-boring-chat=""
      className="chat-panel"
      role="region"
      aria-label="Agent assistant"
    >
      <div
        className="chat-panel__messages boring-chat__messages"
        role="log"
        aria-label="Agent conversation"
        aria-live="polite"
      >
        {messages.length === 0 && !isStreaming ? (
          <div className="boring-chat__empty-state">
            <p className="boring-chat__empty-heading">How can I help?</p>
            <p className="boring-chat__empty-hint">
              Ask me to build, debug, or explore files. Type <kbd>/help</kbd> for commands.
            </p>
          </div>
        ) : null}
        {messages.map((message) => {
          const textParts = message.parts.filter(isTextPart)
          const reasoningParts = message.parts
            .map(getReasoningPart)
            .filter((part): part is ReasoningPartView => part !== null)
          const toolParts = getToolParts(message)

          return (
            <Message key={message.id} role={roleForMessage(message)}>
              {reasoningParts.map((part, index) => (
                <MessagePartContainer key={`reasoning-${message.id}-${index}`}>
                  <Reasoning
                    text={part.text}
                    state={part.state}
                    defaultExpanded={part.state === 'streaming'}
                  />
                </MessagePartContainer>
              ))}

              {textParts.map((part, index) => (
                <MessagePartContainer key={`text-${message.id}-${index}`}>
                  {renderTextWithCodeBlocks(part.text)}
                </MessagePartContainer>
              ))}

              {toolParts.map((toolPart) => {
                const tp = toolPart as unknown as ToolPart
                const name = getToolName(toolPart as any)
                const render = resolveToolRenderer(name, mergedToolRenderers)
                return (
                  <MessagePartContainer key={tp.toolCallId}>
                    {render({ ...tp, toolName: name })}
                  </MessagePartContainer>
                )
              })}
            </Message>
          )
        })}
        {error ? (
          <Message role="assistant">
            <MessagePartContainer>
              <div role="alert" className="boring-chat__error">
                {error.message}
              </div>
            </MessagePartContainer>
          </Message>
        ) : null}
        {statusText(status) ? (
          <div className="boring-chat__status" aria-live="polite">
            {statusText(status)}
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      <Composer ref={composerRef} isStreaming={isStreaming} onSend={handleSend} />
    </div>
  )
}
