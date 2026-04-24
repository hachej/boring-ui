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
import { isModelId, type ModelId } from '../front/components/ModelPicker'
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
import { PaperclipIcon, CopyIcon, CheckIcon, RefreshCwIcon } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { cn } from './lib'

const STORAGE_MODEL_KEY = 'boring-agent:composer:model'

/**
 * Selected model, stored as { provider, id } so the composer can speak
 * pi-coding-agent's real registered IDs (claude-sonnet-4-6, gpt-5.2-codex,
 * …) rather than a 3-alias shorthand. Legacy single-string values
 * (sonnet/haiku/opus) are still honoured for back-compat.
 */
export interface ModelSelection {
  provider: string
  id: string
}

interface AvailableModel extends ModelSelection {
  label: string
  available: boolean
}

const DEFAULT_MODEL: ModelSelection = { provider: 'anthropic', id: 'sonnet' }

function readStoredModel(): ModelSelection {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_MODEL_KEY)
    if (!raw) return DEFAULT_MODEL
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Partial<ModelSelection>
      if (typeof parsed?.provider === 'string' && typeof parsed?.id === 'string') {
        return { provider: parsed.provider, id: parsed.id }
      }
    }
    if (isModelId(raw)) return { provider: 'anthropic', id: raw }
  } catch { /* storage unavailable */ }
  return DEFAULT_MODEL
}

function encodeModelKey(sel: ModelSelection): string {
  return `${sel.provider}:${sel.id}`
}
function decodeModelKey(key: string): ModelSelection | null {
  const idx = key.indexOf(':')
  if (idx < 0) return null
  return { provider: key.slice(0, idx), id: key.slice(idx + 1) }
}

/**
 * Turn whatever AI SDK dumped into error.message into something readable.
 * We try three shapes:
 *   1) raw text (just return it)
 *   2) JSON with { error: { code, message, field? } } — our Fastify shape
 *   3) JSON with { message: … } — AI SDK's generic server-error response
 *
 * Also maps the known validation error codes to friendlier copy.
 */
interface FriendlyError {
  title: string
  detail?: string
}
function friendlyError(err: Error): FriendlyError {
  const raw = err.message ?? ''
  // Non-JSON error (network, etc.)
  if (!raw.startsWith('{')) {
    return { title: raw || 'Something went wrong.' }
  }
  try {
    const parsed = JSON.parse(raw)
    const inner = parsed?.error ?? parsed
    const code = typeof inner?.code === 'string' ? inner.code : undefined
    const message = typeof inner?.message === 'string' ? inner.message : undefined
    const field = typeof inner?.field === 'string' ? inner.field : undefined

    if (code === 'validation_error') {
      const label = field ? `\`${field}\`` : 'the request'
      return {
        title: 'Your message couldn’t be sent.',
        detail: `${label} ${message?.toLowerCase() ?? 'failed validation'}.`,
      }
    }
    if (code === 'internal' || code === 'internal_error') {
      return { title: 'The server hit an internal error.', detail: message }
    }
    return { title: message ?? 'Something went wrong.', detail: code }
  } catch {
    return { title: raw }
  }
}

function displayModelLabel(id: string): string {
  // "claude-sonnet-4-6" → "Claude Sonnet 4.6"
  // "gpt-5.3-codex" → "GPT-5.3 Codex"
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\s(\d+)\s(\d+)/g, ' $1.$2')
    .replace(/\bgpt\b/g, 'GPT')
    .replace(/\b(claude|sonnet|haiku|opus|codex|mini|max|spark)\b/g, (m) =>
      m.charAt(0).toUpperCase() + m.slice(1),
    )
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
  const {
    messages, sendMessage, setMessages, status, error, stop, clearError, regenerate,
  } = useAgentChat({ sessionId })
  const mergedToolRenderers = mergeShadcnToolRenderers(toolRenderers)

  const registry = useMemo(
    () => createCommandRegistry([...builtinCommands, ...(extraCommands ?? [])]),
    [extraCommands],
  )

  const [model, setModel] = useState<ModelSelection>(() => readStoredModel())
  /**
   * Client-side transient notice for attachment validation (too many files,
   * single file too large, …). PromptInput's onError fires synchronously on
   * selection; we mirror it to a small banner below the composer so the user
   * gets immediate feedback without a mysterious silent drop.
   */
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!attachmentNotice) return
    const timer = setTimeout(() => setAttachmentNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [attachmentNotice])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_MODEL_KEY, JSON.stringify(model))
    } catch { /* noop */ }
  }, [model])

  // Fetch the live list from pi's ModelRegistry so the dropdown reflects
  // what the server actually has auth for, not a hardcoded alias set.
  useEffect(() => {
    let aborted = false
    fetch('/api/v1/agent/models')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { models?: AvailableModel[] } | null) => {
        if (aborted || !payload?.models) return
        setAvailableModels(payload.models)
      })
      .catch(() => { /* offline — leave list empty, fall back to raw id text */ })
    return () => { aborted = true }
  }, [])

  // Legacy single-string event payload (used by the /model slash command)
  // still works — treat it as an anthropic short alias.
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (typeof detail === 'string' && isModelId(detail)) {
        setModel({ provider: 'anthropic', id: detail })
      }
    }
    globalThis.addEventListener?.('boring:model-change', onChange)
    return () => globalThis.removeEventListener?.('boring:model-change', onChange)
  }, [])

  const isStreaming = status === 'submitted' || status === 'streaming'

  async function handleSubmit({ text, files }: { text: string; files: FileUIPart[] }): Promise<void> {
    // Guard against pointless empty submits (just Enter with nothing typed
    // and no attachment). The server schema requires message.length >= 1,
    // so an empty POST returns 400 — we catch it here and keep the
    // composer in place with focus for the user to type.
    const trimmed = text.trim()
    if (trimmed.length === 0 && (!files || files.length === 0)) {
      return
    }

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
          model,
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
                    // Symmetric bubbles on both sides for visual parity —
                    // user is tinted primary/12, assistant is a quieter
                    // card/40 surface. Same radius, same padding, same
                    // typography — only the tint differs.
                    "!rounded-lg !px-4 !py-3 text-[15px] leading-relaxed text-foreground",
                    role === 'user'
                      ? '!bg-primary/12 max-w-[80%]'
                      : '!bg-card/40 !border !border-input/40',
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

                  {role === 'assistant' && !isStreaming && textParts.length > 0 && (
                    <MessageActionsBar
                      text={textParts.map((p) => p.text).join('\n\n')}
                      canRegenerate={Boolean(regenerate)}
                      onRegenerate={() => {
                        void regenerate?.()
                      }}
                    />
                  )}
                </MessageContent>
              </Message>
            )
          })}
          {(() => {
            if (!error) return null
            const friendly = friendlyError(error)
            return (
              <Message from="assistant" className="!max-w-full">
                <MessageContent className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
                  <div role="alert" className="flex items-start gap-3 text-sm text-destructive">
                    <div className="mt-0.5 shrink-0">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{friendly.title}</div>
                      {friendly.detail && (
                        <div className="mt-1 text-xs text-destructive/80">{friendly.detail}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => clearError()}
                      className="shrink-0 rounded-md p-1 text-destructive/70 transition hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Dismiss"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </MessageContent>
              </Message>
            )
          })()}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="bg-gradient-to-b from-transparent via-background/70 to-background px-6 pb-8 pt-4">
        {attachmentNotice && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mx-auto mb-2 w-full max-w-3xl rounded-md border border-amber-500/40 bg-amber-500/10",
              "px-3 py-2 text-xs text-amber-200",
            )}
          >
            {attachmentNotice}
          </div>
        )}
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
          <PromptInput
            onSubmit={handleSubmit}
            multiple
            // Guard rails for the attachments pipeline. The server schema
            // caps `attachments` at 20 entries; we match that client-side and
            // add a 5 MB-per-file limit so a giant drag-drop doesn't blow
            // localStorage's ~5 MB origin quota when the cached history grows.
            maxFiles={20}
            maxFileSize={5 * 1024 * 1024}
            onError={(err) => {
              if (err.code === 'max_files') {
                setAttachmentNotice(`Up to ${err.max} attachments per message.`)
              } else if (err.code === 'max_file_size') {
                setAttachmentNotice(`Files must be under ${Math.round(err.max / 1024 / 1024)} MB each.`)
              } else if (err.code === 'accept') {
                setAttachmentNotice(`That file type isn't supported here.`)
              } else {
                setAttachmentNotice(err.message || 'Attachment rejected.')
              }
            }}
          >
            <AttachmentsList />
            <PromptInputTextarea
              placeholder="Ask anything…"
              className={cn(
                "min-h-[48px] resize-none border-0 bg-transparent shadow-none",
                "px-5 pt-3 pb-2 text-[15px] leading-[1.5] placeholder:text-muted-foreground/60",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
              )}
            />
            <PromptInputFooter
              className={cn(
                "flex items-center gap-2 border-0 bg-transparent",
                "px-2.5 pb-2.5 pt-0",
              )}
            >
              {/* Left-side actions cluster so attach + model feel like one
               * group rather than two disconnected controls. */}
              <div className="flex items-center gap-1">
                <AttachmentButton />
                <ModelSelect
                  value={model}
                  onChange={setModel}
                  options={availableModels}
                  disabled={isStreaming}
                />
              </div>
              <PromptInputSubmit
                status={status}
                onStop={stop}
                className={cn(
                  // Primary action pinned far-right; becomes a Stop affordance
                  // (square icon + aria-label="Stop") while the turn streams.
                  "ml-auto h-8 w-8 rounded-md bg-primary text-primary-foreground shadow-sm transition",
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

/**
 * Model picker whose options are pi-coding-agent's actual available
 * models (fetched from /api/v1/agent/models). Groups by provider and
 * shows a concise human-friendly label with the raw pi id as the
 * SelectItem's stored value, encoded as "{provider}:{id}" to keep
 * ids stable across providers.
 */
function ModelSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: ModelSelection
  onChange: (next: ModelSelection) => void
  options: AvailableModel[]
  disabled?: boolean
}) {
  // Group by provider, preserving the server's already-sorted order.
  const groups = new Map<string, AvailableModel[]>()
  for (const m of options) {
    if (!m.available) continue
    const list = groups.get(m.provider) ?? []
    list.push(m)
    groups.set(m.provider, list)
  }

  const currentKey = encodeModelKey(value)
  // Trigger label prefers a live entry, falls back to raw id for offline /
  // legacy short-alias sessions so the label never goes blank.
  const current = options.find((m) => m.provider === value.provider && m.id === value.id)
  const triggerLabel = current?.label ?? displayModelLabel(value.id)

  return (
    <Select
      value={currentKey}
      onValueChange={(next) => {
        const parsed = decodeModelKey(next)
        if (parsed) onChange(parsed)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(composerActionClass, "px-3 text-xs font-medium")}
        aria-label="Model"
      >
        <SelectValue>{triggerLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        {[...groups.entries()].map(([provider, list]) => (
          <div key={provider} className="px-1 py-1">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
              {provider}
            </div>
            {list.map((m) => (
              <SelectItem
                key={encodeModelKey(m)}
                value={encodeModelKey(m)}
                className="text-xs font-medium"
              >
                {m.label || displayModelLabel(m.id)}
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  )
}


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
  // data-align=block-start flips PromptInput's InputGroup into flex-col so
  // this row occupies its own horizontal band and the chips anchor to the
  // left edge instead of being center-distributed between textarea + footer.
  return (
    <Attachments
      data-align="block-start"
      variant="inline"
      className="w-full flex-wrap items-center justify-start gap-2 px-5 pt-3 pb-1"
    >
      {attachments.files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => attachments.remove(file.id)}
          className={cn(
            // Compact pill — medium border, muted fill, room for a
            // thumbnail + name + remove action.
            "!h-9 !gap-2 !rounded-full !border-input/80 !bg-muted/40 !pl-1 !pr-2",
            "transition-colors hover:!bg-muted/70 hover:!text-foreground",
          )}
        >
          <AttachmentPreview
            // Fixed thumbnail slot; <img> fills via object-cover.
            className="!size-7 shrink-0 overflow-hidden !rounded-full bg-background/60"
          />
          <AttachmentInfo
            className="min-w-0 !max-w-[180px] truncate text-[13px] font-medium"
          />
          <AttachmentRemove
            className={cn(
              // Always-visible remove affordance; default inline variant
              // hides it until hover which is too discoverable-averse here.
              "!size-5 !rounded-full !opacity-100 text-muted-foreground/80 hover:text-foreground",
            )}
          />
        </Attachment>
      ))}
    </Attachments>
  )
}

/**
 * Per-message action bar. Appears on assistant messages once the turn
 * has finished streaming, giving the user a quick copy and regenerate
 * pair — standard ChatGPT/Claude affordances. Stays invisible until the
 * user hovers the message so it doesn't clutter the idle reading state.
 */
function MessageActionsBar({
  text,
  canRegenerate,
  onRegenerate,
}: {
  text: string
  canRegenerate: boolean
  onRegenerate: () => void
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => { /* permission denied — silently ignore */ },
    )
  }
  const actionBtnClass = cn(
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2",
    "text-[12px] font-medium text-muted-foreground transition",
    "hover:bg-accent hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  )
  return (
    <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
      <button type="button" onClick={handleCopy} className={actionBtnClass} aria-label={copied ? 'Copied' : 'Copy message'}>
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-400" /> : <CopyIcon className="h-3.5 w-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {canRegenerate && (
        <button type="button" onClick={onRegenerate} className={actionBtnClass} aria-label="Regenerate">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          <span>Regenerate</span>
        </button>
      )}
    </div>
  )
}
