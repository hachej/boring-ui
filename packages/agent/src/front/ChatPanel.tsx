import type { UIMessage } from 'ai'
import { isToolUIPart, getToolName } from 'ai'
import type { UiBridge } from '../shared/ui-bridge'
import { Composer, type ComposerSendInput } from './components/Composer'
import { useAgentChat } from './hooks/useAgentChat'
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
  const { sessionId, toolRenderers } = props
  const { messages, sendMessage, status, error } = useAgentChat({ sessionId })
  const mergedToolRenderers = mergeToolRenderers(toolRenderers)

  const isStreaming = status === 'submitted' || status === 'streaming'

  async function handleSend(input: ComposerSendInput): Promise<void> {
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
