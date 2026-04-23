import type { UIMessage } from 'ai'
import { isToolUIPart, getToolName } from 'ai'
import { useMemo } from 'react'
import type { UiBridge } from '../shared/ui-bridge'
import { useAgentChat } from '../front/hooks/useAgentChat'
import { builtinCommands } from '../front/slashCommands/builtins'
import { parseSlashCommand } from '../front/slashCommands/parser'
import { createCommandRegistry, type SlashCommand, type SlashCommandContext } from '../front/slashCommands/registry'
import { isModelId } from '../front/components/ModelPicker'
import {
  mergeToolRenderers,
  resolveToolRenderer,
  type ToolPart,
  type ToolRendererOverrides,
} from '../front/toolRenderers'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './primitives/conversation'
import { Message, MessageContent, MessageResponse } from './primitives/message'
import { Reasoning, ReasoningTrigger, ReasoningContent } from './primitives/reasoning'
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from './primitives/prompt-input'
import { cn } from './lib'

export interface ChatPanelProps {
  sessionId: string
  bridge?: UiBridge
  toolRenderers?: ToolRendererOverrides
  extraCommands?: SlashCommand[]
  onSessionReset?: () => void | Promise<void>
  className?: string
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
  if (!record || record.type !== 'reasoning') return null
  const textCandidate = record.text ?? record.content
  if (typeof textCandidate !== 'string' || textCandidate.length === 0) return null
  const stateCandidate = record.state
  return {
    text: textCandidate,
    state: stateCandidate === 'streaming' ? 'streaming' : 'done',
  }
}

function getToolParts(message: UIMessage): Array<UIMessage['parts'][number]> {
  return message.parts.filter(isToolUIPart)
}

function ToolCard({ toolPart, mergedToolRenderers }: { toolPart: UIMessage['parts'][number]; mergedToolRenderers: ToolRendererOverrides }) {
  const tp = toolPart as unknown as ToolPart
  const name = getToolName(toolPart as any)
  const render = resolveToolRenderer(name, mergedToolRenderers)
  return (
    <div key={tp.toolCallId} className="rounded-lg border bg-card p-3 text-sm">
      {render({ ...tp, toolName: name })}
    </div>
  )
}

export function ChatPanel(props: ChatPanelProps) {
  const { sessionId, toolRenderers, extraCommands, onSessionReset, className } = props
  const { messages, sendMessage, setMessages, status, error } = useAgentChat({ sessionId })
  const mergedToolRenderers = mergeToolRenderers(toolRenderers)

  const registry = useMemo(
    () => createCommandRegistry([...builtinCommands, ...(extraCommands ?? [])]),
    [extraCommands],
  )

  const isStreaming = status === 'submitted' || status === 'streaming'

  async function handleSubmit({ text }: { text: string; files: unknown[] }): Promise<void> {
    const parsed = parseSlashCommand(text)
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
      { text },
      {
        body: {
          sessionId,
          message: text,
        },
      },
    )
  }

  return (
    <div
      data-boring-chat=""
      className={cn("flex h-full flex-col bg-background text-foreground", className)}
      role="region"
      aria-label="Agent assistant"
    >
      <Conversation className="flex-1" aria-label="Agent conversation" aria-live="polite">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="How can I help?"
              description="Ask me anything about your codebase."
            />
          )}
          {messages.map((message) => {
            const role = message.role === 'user' || message.role === 'assistant' ? message.role : 'assistant'
            const textParts = message.parts.filter(isTextPart)
            const reasoningParts = message.parts
              .map(getReasoningPart)
              .filter((part): part is ReasoningPartView => part !== null)
            const toolParts = getToolParts(message)

            return (
              <Message key={message.id} from={role}>
                <MessageContent>
                  {reasoningParts.map((part, index) => (
                    <Reasoning
                      key={`reasoning-${message.id}-${index}`}
                      isStreaming={part.state === 'streaming'}
                      defaultOpen={part.state === 'streaming'}
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{part.text}</ReasoningContent>
                    </Reasoning>
                  ))}

                  {textParts.map((part, index) => (
                    <MessageResponse key={`text-${message.id}-${index}`}>
                      {part.text}
                    </MessageResponse>
                  ))}

                  {toolParts.map((toolPart) => (
                    <ToolCard
                      key={(toolPart as unknown as ToolPart).toolCallId}
                      toolPart={toolPart}
                      mergedToolRenderers={mergedToolRenderers}
                    />
                  ))}
                </MessageContent>
              </Message>
            )
          })}
          {error ? (
            <Message from="assistant">
              <MessageContent>
                <div role="alert" className="text-destructive text-sm">
                  {error.message}
                </div>
              </MessageContent>
            </Message>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea placeholder="Message..." />
          <PromptInputFooter>
            <div />
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
