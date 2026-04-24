import type { FileUIPart, UIMessage } from 'ai'
import { isToolUIPart, getToolName } from 'ai'

const INLINE_TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/yaml']

/** Best-effort fetch of a FileUIPart's bytes as UTF-8 text. */
async function readFileAsText(file: FileUIPart): Promise<string | null> {
  const looksText =
    INLINE_TEXT_MIME_PREFIXES.some((p) => file.mediaType?.startsWith(p)) ||
    /\.(md|txt|csv|json|yaml|yml|ts|tsx|js|jsx|py|rb|rs|go|sh|bash|css|html|sql|log)$/i.test(file.filename ?? '')
  if (!looksText) return null
  try {
    const res = await fetch(file.url)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}
import { useEffect, useMemo, useState } from 'react'
import type { UiBridge } from '../shared/ui-bridge'
import { useAgentChat } from '../front/hooks/useAgentChat'
import { builtinCommands } from '../front/slashCommands/builtins'
import { parseSlashCommand } from '../front/slashCommands/parser'
import { createCommandRegistry, type SlashCommand, type SlashCommandContext } from '../front/slashCommands/registry'
import { isModelId, MODEL_IDS, type ModelId } from '../front/components/ModelPicker'
import {
  resolveToolRenderer,
  type ToolPart,
  type ToolRendererOverrides,
} from '../front/toolRenderers'
import { mergeShadcnToolRenderers } from './toolRenderers'
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
  usePromptInputAttachments,
} from './primitives/prompt-input'
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
  AttachmentRemove,
} from './primitives/attachments'
import { PaperclipIcon } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { cn } from './lib'

const STORAGE_MODEL_KEY = 'boring-agent:composer:model'
const DEFAULT_MODEL: ModelId = 'sonnet'

function readStoredModel(): ModelId {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_MODEL_KEY)
    if (raw && isModelId(raw)) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_MODEL
}

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

function isFilePart(part: UIMessage['parts'][number]): part is FileUIPart {
  return part.type === 'file'
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
  // Renderer owns its own container. No wrapping div — avoids the
  // "nested box" feel when a consumer-supplied renderer already styles its
  // outer element.
  return <>{render({ ...tp, toolName: name })}</>
}

export function ChatPanel(props: ChatPanelProps) {
  const { sessionId, toolRenderers, extraCommands, onSessionReset, className } = props
  const { messages, sendMessage, setMessages, status, error } = useAgentChat({ sessionId })
  const mergedToolRenderers = mergeShadcnToolRenderers(toolRenderers)

  const registry = useMemo(
    () => createCommandRegistry([...builtinCommands, ...(extraCommands ?? [])]),
    [extraCommands],
  )

  const [model, setModel] = useState<ModelId>(() => readStoredModel())
  useEffect(() => {
    try { globalThis.localStorage?.setItem(STORAGE_MODEL_KEY, model) } catch { /* noop */ }
  }, [model])
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (typeof detail === 'string' && isModelId(detail)) setModel(detail)
    }
    globalThis.addEventListener?.('boring:model-change', onChange)
    return () => globalThis.removeEventListener?.('boring:model-change', onChange)
  }, [])

  const isStreaming = status === 'submitted' || status === 'streaming'

  async function handleSubmit({ text, files }: { text: string; files: FileUIPart[] }): Promise<void> {
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

    // Build the server-side enriched message (text attachments inlined for
    // pi, which is text-only). Importantly, the VISIBLE user bubble only
    // shows the raw `text` plus file chips — the enriched version is not
    // rendered in the UI, just sent to the server. This keeps
    // "[attached: foo.png …]" markers out of the message bubble.
    const attachmentSummaries: string[] = []
    for (const file of files ?? []) {
      const label = file.filename ?? 'attachment'
      const mime = file.mediaType ?? 'application/octet-stream'
      const content = await readFileAsText(file)
      if (content !== null) {
        attachmentSummaries.push(`[attached: ${label} (${mime})]\n\`\`\`\n${content}\n\`\`\``)
      } else {
        attachmentSummaries.push(`[attached: ${label} (${mime}, not inlined — binary)]`)
      }
    }
    const serverMessage = attachmentSummaries.length > 0
      ? [text.trim(), attachmentSummaries.join('\n\n')].filter(Boolean).join('\n\n')
      : text

    // Fire-and-forget the send so handleSubmit returns as soon as the
    // payload is built. PromptInput clears attachments + text only after
    // the onSubmit Promise resolves — if we awaited `sendMessage`, the
    // composer chips would linger for the entire duration of the server
    // stream. The send still runs (and errors still surface via useChat's
    // `error` state rendered above).
    void sendMessage(
      {
        // Rendered bubble: unchanged user text + file chips via files parts.
        text,
        files,
      },
      {
        body: {
          sessionId,
          // Payload actually sent to the agent (inlined text attachments).
          message: serverMessage,
          model: { provider: 'anthropic', id: model },
          attachments: files?.map((f) => ({
            filename: f.filename,
            mediaType: f.mediaType,
            // Keep the data URL so the server could later forward images
            // to multimodal-capable providers.
            url: f.url,
          })) ?? [],
        },
      },
    )
  }

  return (
    <div
      data-boring-chat=""
      className={cn(
        "flex h-full flex-col bg-background text-[15px] text-foreground antialiased",
        "[font-feature-settings:'ss01','cv11']",
        className,
      )}
      role="region"
      aria-label="Agent assistant"
    >
      <Conversation className="flex-1" aria-label="Agent conversation" aria-live="polite">
        <ConversationContent className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
          {messages.length === 0 && (
            <ConversationEmptyState
              title="How can I help?"
              description="Ask anything. I can reverse strings, explain code, and walk through ideas."
            />
          )}
          {messages.map((message) => {
            const role = message.role === 'user' || message.role === 'assistant' ? message.role : 'assistant'
            const textParts = message.parts.filter(isTextPart)
            const fileParts = message.parts.filter(isFilePart)
            const reasoningParts = message.parts
              .map(getReasoningPart)
              .filter((part): part is ReasoningPartView => part !== null)
            const toolParts = getToolParts(message)

            return (
              <Message
                key={message.id}
                from={role}
                // Reset primitive defaults so our deliberate sizing sticks.
                className="!max-w-full !gap-3"
              >
                <MessageContent
                  className={cn(
                    // User bubble: pill-ish, primary-tinted, right-aligned.
                    role === 'user'
                      ? '!rounded-lg !bg-primary/12 !px-4 !py-3 text-[15px] leading-relaxed text-foreground max-w-[80%]'
                      // Assistant: no bubble — just content with prose wrapping.
                      : '!bg-transparent !px-0 !py-1 text-[15px] leading-relaxed',
                  )}
                >
                  {fileParts.length > 0 && (
                    <Attachments
                      variant="list"
                      className={cn(
                        "gap-1.5",
                        // Inside a user bubble, chips should feel like part
                        // of the bubble surface — no competing border/bg
                        // that produces a "box in a box" look. Assistant
                        // messages (no bubble) keep the bordered chip.
                        role === 'user'
                          ? '[&>div]:border-0 [&>div]:bg-transparent [&>div]:px-0 [&>div]:py-1 [&>div:hover]:bg-transparent'
                          : undefined,
                      )}
                    >
                      {fileParts.map((file, idx) => (
                        <Attachment key={`file-${message.id}-${idx}`} data={{ ...file, id: `file-${message.id}-${idx}` }}>
                          <AttachmentPreview className="size-10 shrink-0 rounded-md" />
                          <AttachmentInfo className="min-w-0 flex-1" />
                        </Attachment>
                      ))}
                    </Attachments>
                  )}

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
                    <MessageResponse
                      key={`text-${message.id}-${index}`}
                      className={cn(
                        "max-w-none",
                        // Typography (size + spacing).
                        "prose prose-invert prose-neutral",
                        "prose-p:my-3 prose-p:leading-[1.65] prose-p:text-[15px]",
                        "prose-headings:mt-5 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-tight",
                        "prose-ul:my-3 prose-ul:pl-6 prose-ol:my-3 prose-ol:pl-6",
                        "prose-li:my-1.5 prose-li:leading-[1.7] prose-li:pl-1 prose-li:marker:text-muted-foreground/70",
                        "prose-strong:font-semibold prose-strong:text-foreground",
                        "prose-em:text-foreground/90",
                        "prose-a:text-primary prose-a:underline-offset-4 hover:prose-a:underline",
                        // Inline code chips.
                        "prose-code:font-mono prose-code:text-[13px] prose-code:font-medium",
                        "prose-code:rounded-md prose-code:border prose-code:border-input/70 prose-code:bg-muted/50",
                        "prose-code:px-1.5 prose-code:py-0.5",
                        "prose-code:before:content-none prose-code:after:content-none",
                        // Multi-line code blocks — the CodeBlock primitive owns
                        // its own container styling; strip prose defaults so
                        // we don't double-wrap with another border + bg.
                        "prose-pre:my-0 prose-pre:rounded-none prose-pre:border-0",
                        "prose-pre:bg-transparent prose-pre:p-0",
                      )}
                    >
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
            <Message from="assistant" className="!max-w-full">
              <MessageContent className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
                <div role="alert" className="text-destructive text-sm">
                  {error.message}
                </div>
              </MessageContent>
            </Message>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="bg-gradient-to-b from-transparent via-background/70 to-background px-6 pb-8 pt-4">
        <div
          className={cn(
            "mx-auto w-full max-w-3xl",
            // Opaque single-layer shell with a clear border so the input has
            // obvious affordance even at rest.
            "rounded-xl border border-input bg-card",
            "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_10px_24px_-14px_rgba(0,0,0,0.55),0_24px_48px_-28px_rgba(0,0,0,0.45)]",
            "transition-colors focus-within:border-foreground/30",
            // Neutralize the inner InputGroup's default border/rounded/shadow.
            "[&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:rounded-none",
            "[&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:bg-transparent",
            "[&_[data-slot=input-group]]:dark:bg-transparent [&_[data-slot=input-group]]:ring-0",
            "[&_[data-slot=input-group]]:has-[:focus]:ring-0",
            "overflow-hidden",
          )}
        >
          <PromptInput onSubmit={handleSubmit} multiple>
            <AttachmentsList />
            <PromptInputTextarea
              placeholder="Ask anything…"
              className={cn(
                "min-h-[60px] resize-none border-0 bg-transparent shadow-none",
                "px-5 pt-4 pb-3 text-[15px] leading-[1.55] placeholder:text-muted-foreground/60",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
              )}
            />
            <PromptInputFooter
              className={cn(
                "flex items-center gap-2 border-0 bg-transparent",
                "px-3 pb-3 pt-0",
              )}
            >
              <AttachmentButton />
              <Select
                value={model}
                onValueChange={(value) => { if (isModelId(value)) setModel(value) }}
                disabled={isStreaming}
              >
                <SelectTrigger
                  className={cn(
                    composerActionClass,
                    "px-3 text-xs font-medium capitalize",
                  )}
                  aria-label="Model"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_IDS.map((id) => (
                    <SelectItem key={id} value={id} className="text-xs font-medium capitalize">
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="ml-auto" />
              <PromptInputSubmit
                status={status}
                className={cn(
                  // Prominent, squared-off primary action. Slightly larger
                  // than the other composer buttons so it carries weight.
                  "h-9 w-9 rounded-md bg-primary text-primary-foreground shadow-sm transition",
                  "hover:bg-primary/90 hover:shadow",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  "disabled:pointer-events-none disabled:opacity-50",
                  "[&>svg]:size-4",
                )}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  )
}

// ---- Composer helpers ----

// Shared composer-action surface — single opinion on size, radius, hover,
// focus, and disabled states. Every button inside the composer footer
// wraps this so we never drift.
const composerActionClass = cn(
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border-0 bg-transparent",
  "text-muted-foreground shadow-none transition",
  "hover:bg-muted/60 hover:text-foreground",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "disabled:pointer-events-none disabled:opacity-50",
)

function AttachmentButton() {
  const attachments = usePromptInputAttachments()
  return (
    <button
      type="button"
      onClick={() => attachments.openFileDialog()}
      className={cn(composerActionClass, "w-8")}
      aria-label="Attach files"
    >
      <PaperclipIcon className="h-4 w-4" />
    </button>
  )
}

function AttachmentsList() {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null
  return (
    <div className="border-b border-input/50 px-3 py-2">
      <Attachments variant="list" className="gap-1.5">
        {attachments.files.map((file) => (
          <Attachment key={file.id} data={file} onRemove={() => attachments.remove(file.id)}>
            <AttachmentPreview className="size-9 shrink-0 rounded-md" />
            <AttachmentInfo className="min-w-0 flex-1" />
            <AttachmentRemove />
          </Attachment>
        ))}
      </Attachments>
    </div>
  )
}
