import type { UIMessage } from 'ai'
import { isToolUIPart, getToolName } from 'ai'
import { useMemo } from 'react'
import type { UiBridge } from '../shared/ui-bridge'
import './styles/theme.css'
import { Composer, type ComposerSendInput } from './components/Composer'
import { isModelId } from './components/ModelPicker'
import { useAgentChat } from './hooks/useAgentChat'
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

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join('')
}

function getToolParts(message: UIMessage): Array<UIMessage['parts'][number]> {
  return message.parts.filter(isToolUIPart)
}

export function ChatPanel(props: ChatPanelProps) {
  const { sessionId, toolRenderers, extraCommands, onSessionReset } = props
  const { messages, sendMessage, setMessages, status, error } = useAgentChat({ sessionId })
  const mergedToolRenderers = mergeToolRenderers(toolRenderers)

  const registry = useMemo(
    () => createCommandRegistry([...builtinCommands, ...(extraCommands ?? [])]),
    [extraCommands],
  )

  const isStreaming = status === 'submitted' || status === 'streaming'

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
  }

  return (
    <div
      data-boring-chat=""
      className="chat-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div
        className="chat-panel__messages"
        style={{ flex: 1, overflow: 'auto' }}
      >
        {messages.map((message) => {
          const text = getMessageText(message)
          const toolParts = getToolParts(message)

          return (
            <div key={message.id} data-role={message.role}>
              <div>{message.role}</div>
              {text ? <div>{text}</div> : null}
              {toolParts.map((toolPart) => {
                const tp = toolPart as unknown as ToolPart
                const name = getToolName(toolPart as any)
                const render = resolveToolRenderer(name, mergedToolRenderers)
                return <div key={tp.toolCallId}>{render({ ...tp, toolName: name })}</div>
              })}
            </div>
          )
        })}
        {error ? <div role="alert">{error.message}</div> : null}
      </div>

      <Composer isStreaming={isStreaming} onSend={handleSend} />
    </div>
  )
}
