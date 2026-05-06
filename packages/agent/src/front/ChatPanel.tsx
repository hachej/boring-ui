import type { FileUIPart, UIMessage } from 'ai'
import { isToolUIPart } from 'ai'
import { motion } from 'motion/react'

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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MentionPicker, detectMention, type MentionState } from './primitives/mention-picker'
import { SlashCommandPicker } from './primitives/slash-command-picker'
import { useAgentChat } from './hooks/useAgentChat'
import { DebugDrawer } from './DebugDrawer'
import { builtinCommands } from './slashCommands/builtins'
import { parseSlashCommand } from './slashCommands/parser'
import { createCommandRegistry, type SlashCommand, type SlashCommandContext } from './slashCommands/registry'
import { isModelId, type ModelId } from './components/ModelPicker'
import {
  type ToolRendererOverrides,
} from './bareToolRenderers'
import { ToolCallGroup, type GroupedToolEntry } from './primitives/tool-call-group'
import { mergeShadcnToolRenderers } from './toolRenderers'
import { ArtifactOpenProvider, type OpenArtifactHandler } from './ArtifactOpenContext'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './primitives/conversation'
import { ChatEmptyState, defaultChatSuggestions, type ChatSuggestion } from './ChatEmptyState'
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
import { PaperclipIcon, CopyIcon, CheckIcon, RefreshCwIcon, BrainIcon, EyeIcon, EyeOffIcon, BotIcon } from 'lucide-react'
import {
  Button,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@boring/ui'
import { cn } from './lib'

const STORAGE_MODEL_KEY = 'boring-agent:composer:model'
const STORAGE_MODEL_USER_KEY = 'boring-agent:composer:model:user-selected'
const STORAGE_THINKING_KEY = 'boring-agent:composer:thinking'
const STORAGE_SHOW_THOUGHTS_KEY = 'boring-agent:composer:show-thoughts'

/**
 * Extended-thinking budget. Sent through to pi-coding-agent which forwards
 * it to providers that support it (Anthropic Claude 4.x). 'off' means no
 * reasoning chunks; the higher tiers progressively allow more think-time.
 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

const DEFAULT_THINKING: ThinkingLevel = 'off'
const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high']

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
}

function readStoredThinking(): ThinkingLevel {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_THINKING_KEY)
    if (isThinkingLevel(raw)) return raw
  } catch { /* storage unavailable */ }
  return DEFAULT_THINKING
}

function readStoredShowThoughts(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_SHOW_THOUGHTS_KEY) === '1'
  } catch { /* storage unavailable */ }
  return false
}

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

const DEFAULT_MODEL: ModelSelection = { provider: 'qwen', id: 'qwen3.5' }

function readStoredModel(): ModelSelection | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_MODEL_KEY)
    if (!raw) return null
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Partial<ModelSelection>
      if (typeof parsed?.provider === 'string' && typeof parsed?.id === 'string') {
        return { provider: parsed.provider, id: parsed.id }
      }
    }
    if (isModelId(raw)) return { provider: 'anthropic', id: raw }
  } catch { /* storage unavailable */ }
  return null
}

function readStoredModelState(): { model: ModelSelection | null; userSelected: boolean } {
  const model = readStoredModel()
  let userSelected = false
  try {
    userSelected = globalThis.localStorage?.getItem(STORAGE_MODEL_USER_KEY) === '1'
  } catch { /* storage unavailable */ }
  return {
    // Only an explicit user-selection marker makes a stored model authoritative.
    // App defaults must come from props or /api/v1/agent/models.defaultModel;
    // otherwise child apps that seed localStorage can silently override the
    // composer after the user picks a different provider.
    model: userSelected ? model : null,
    userSelected,
  }
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
  const modelId = id.split('/').pop() ?? id
  return modelId
    .replace(/[-_]/g, ' ')
    .replace(/\s(\d+)\s(\d+)/g, ' $1.$2')
    .replace(/\bgpt\b/g, 'GPT')
    .replace(/\b(qwen|grok|glm|claude|sonnet|haiku|opus|codex|mini|max|spark|flash|turbo|pro|omni|mimo|deepseek|euryale)\b/g, (m) =>
      m.charAt(0).toUpperCase() + m.slice(1),
    )
}

function displayProviderLabel(provider: string): string {
  const known: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    'openai-codex': 'OpenAI Codex',
    infomaniak: 'Infomaniak',
  }
  if (known[provider]) return known[provider]
  return provider
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export interface ChatPanelProps {
  sessionId: string
  toolRenderers?: ToolRendererOverrides
  extraCommands?: SlashCommand[]
  onSessionReset?: () => void | Promise<void>
  /**
   * Render flush, without the outer canvas tint or the inner mx/my rounded
   * card chrome. Use when embedding ChatPanel inside a parent that already
   * provides its own card surface (e.g. workspace's ChatCenteredShell).
   * Defaults to `true` (standalone chrome on).
   */
  chrome?: boolean
  /**
   * Cards shown when the conversation is empty. Click → sendMessage with the
   * suggestion's `prompt` (or `label` as fallback). Pass `[]` to hide the
   * grid; omit to inherit `defaultChatSuggestions`. Customizable per child
   * app — e.g. a data-app might offer "Build a chart from a CSV" instead.
   */
  suggestions?: ChatSuggestion[]
  /** Eyebrow above the empty-state headline. */
  emptyEyebrow?: string
  /** Empty-state headline. */
  emptyTitle?: string
  /** Empty-state description below the headline. */
  emptyDescription?: string
  /**
   * Render the extended-thinking selector in the composer footer (off / low
   * / medium / high). When enabled, the selected level is persisted in
   * localStorage and sent through to the agent on every turn. Default off
   * — opt-in because not every host wants users tweaking model knobs, and
   * thinking budget consumes more tokens.
   */
  thinkingControl?: boolean
  /**
   * Model selected before any local user choice exists. Usually supplied by
   * the host's /api/v1/agent/models payload, so deployment env can choose
   * the default without rebuilding consumers.
   */
  defaultModel?: ModelSelection
  /**
   * Tap into the SSE data stream. Called for every `onData` part the
   * agent emits — host apps use this to bridge agent-driven file
   * changes into their own UI plumbing (see
   * `useAgentFileChangeBridge` in `@boring/workspace` for the
   * canonical wire-up).
   */
  onData?: (part: unknown) => void
  /** Headers sent with chat and chat-history requests. */
  requestHeaders?: Record<string, string>
  /**
   * Called with a file path when the user clicks the path label inside
   * a read / write / edit tool card. Hosts (e.g. @boring/workspace)
   * supply this to open the file in the surrounding workbench. Without
   * it the path renders as plain text. Mounted via context so any
   * future renderer can consume it without a prop drill.
   */
  onOpenArtifact?: OpenArtifactHandler
  /**
   * Enable the admin debug drawer — system prompt, raw messages JSON, and
   * live onData stream events. Intended for development and ops; keep off
   * in production consumer UIs.
   */
  debug?: boolean
  className?: string
}

function isTextPart(part: UIMessage['parts'][number]): part is Extract<UIMessage['parts'][number], { type: 'text' }> {
  return part.type === 'text'
}

function isBlankTextPart(part: UIMessage['parts'][number]): boolean {
  return isTextPart(part) && part.text.trim().length === 0
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


export function ChatPanel(props: ChatPanelProps) {
  const {
    sessionId,
    toolRenderers,
    extraCommands,
    onSessionReset,
    className,
    chrome = true,
    suggestions = defaultChatSuggestions,
    emptyEyebrow,
    emptyTitle,
    emptyDescription,
    thinkingControl = false,
    defaultModel,
    onData,
    requestHeaders,
    onOpenArtifact,
    debug = false,
  } = props
  const [debugWidth, setDebugWidth] = useState(440)
  const {
    messages, sendMessage, setMessages, status, error, stop, clearError,
  } = useAgentChat({ sessionId, onData, requestHeaders })
  const mergedToolRenderers = mergeShadcnToolRenderers(toolRenderers)

  const registry = useMemo(
    () => createCommandRegistry([...builtinCommands, ...(extraCommands ?? [])]),
    [extraCommands],
  )
  // Bumped when server skills are added to registry so the picker re-renders
  const [skillsStamp, setSkillsStamp] = useState(0)
  const allCommands = useMemo(() => registry.list(), [registry, skillsStamp])

  const initialModelState = useMemo(readStoredModelState, [])
  const [model, setModelState] = useState<ModelSelection>(
    () => initialModelState.model ?? defaultModel ?? DEFAULT_MODEL,
  )
  const [userSelectedModel, setUserSelectedModel] = useState<boolean>(
    () => initialModelState.userSelected,
  )
  const userSelectedModelRef = useRef(userSelectedModel)
  useEffect(() => {
    userSelectedModelRef.current = userSelectedModel
  }, [userSelectedModel])
  const setModel = useCallback((next: ModelSelection) => {
    setUserSelectedModel(true)
    setModelState(next)
  }, [])
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() =>
    thinkingControl ? readStoredThinking() : DEFAULT_THINKING,
  )
  const [showThoughts, setShowThoughts] = useState<boolean>(() => readStoredShowThoughts())
  useEffect(() => {
    if (!thinkingControl) return
    try {
      globalThis.localStorage?.setItem(STORAGE_THINKING_KEY, thinkingLevel)
    } catch { /* noop */ }
  }, [thinkingControl, thinkingLevel])
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_SHOW_THOUGHTS_KEY, showThoughts ? '1' : '0')
    } catch { /* noop */ }
  }, [showThoughts])
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
    if (!userSelectedModel) return
    try {
      globalThis.localStorage?.setItem(STORAGE_MODEL_KEY, JSON.stringify(model))
      globalThis.localStorage?.setItem(STORAGE_MODEL_USER_KEY, '1')
    } catch { /* noop */ }
  }, [model, userSelectedModel])

  useEffect(() => {
    if (userSelectedModelRef.current || !defaultModel) return
    setModelState(defaultModel)
  }, [defaultModel])

  // Fetch the live list from pi's ModelRegistry so the dropdown reflects
  // what the server actually has auth for, not a hardcoded alias set.
  useEffect(() => {
    let aborted = false
    fetch('/api/v1/agent/models', { headers: requestHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { models?: AvailableModel[]; defaultModel?: ModelSelection } | null) => {
        if (aborted || !payload?.models) return
        setAvailableModels(payload.models)
        const available = payload.models.filter((m) => m.available)
        const fallbackModel = payload.defaultModel ?? available[0]
        if (fallbackModel) {
          setModelState((current) => {
            const currentAvailable = available.some(
              (m) => m.provider === current.provider && m.id === current.id,
            )
            if (currentAvailable) return current
            userSelectedModelRef.current = false
            setUserSelectedModel(false)
            try {
              globalThis.localStorage?.removeItem(STORAGE_MODEL_KEY)
              globalThis.localStorage?.removeItem(STORAGE_MODEL_USER_KEY)
            } catch { /* noop */ }
            return { provider: fallbackModel.provider, id: fallbackModel.id }
          })
        } else if (payload.defaultModel && !userSelectedModelRef.current) {
          setModelState(payload.defaultModel)
        }
      })
      .catch(() => { /* offline — leave list empty, fall back to raw id text */ })
    return () => { aborted = true }
  }, [requestHeaders])

  // Fetch PI skills and register them so the slash picker shows them without
  // host apps needing to hardcode them in extraCommands. Server skills never
  // overwrite builtins or host-provided extraCommands (first-write wins).
  useEffect(() => {
    let aborted = false
    fetch('/api/v1/agent/skills', { headers: requestHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { skills?: Array<{ name: string; description: string }> } | null) => {
        if (aborted || !payload?.skills) return
        let added = 0
        for (const skill of payload.skills) {
          if (!registry.get(skill.name)) {
            registry.register({ name: skill.name, description: skill.description, kind: 'skill', handler: () => {} })
            added++
          }
        }
        if (added > 0) setSkillsStamp((n) => n + 1)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [requestHeaders, registry])

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

  // Compose-history navigation (↑/↓ like a terminal)
  const userHistory = useMemo(() =>
    messages
      .filter((m) => m.role === 'user')
      .map((m) => m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n').trim())
      .filter(Boolean),
    [messages],
  )
  const historyIdxRef = useRef(-1)
  const draftRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionState, setMentionState] = useState<MentionState | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([])

  const handleComposerChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    textareaRef.current = ta
    const cursor = ta.selectionStart ?? ta.value.length
    const before = ta.value.slice(0, cursor)
    const slashMatch = before.match(/^\/(\S*)$/)
    if (slashMatch) {
      setSlashQuery(slashMatch[1])
      setMentionState(null)
    } else {
      setSlashQuery(null)
      setMentionState(detectMention(ta.value, cursor))
    }
  }, [])

  const selectMention = useCallback((path: string) => {
    const ta = textareaRef.current
    if (!ta || !mentionState) return
    const { anchorStart, anchorEnd } = mentionState
    const token = `@${path.split('/').pop() ?? path}`
    const newValue = ta.value.slice(0, anchorStart) + token + ta.value.slice(anchorEnd)
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, newValue)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const newCursor = anchorStart + token.length
    ta.setSelectionRange(newCursor, newCursor)
    ta.focus()
    setMentionState(null)
    setMentionedFiles((prev) => prev.includes(path) ? prev : [...prev, path])
  }, [mentionState])

  const selectSlashCommand = useCallback((name: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const newValue = `/${name} `
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, newValue)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.setSelectionRange(newValue.length, newValue.length)
    ta.focus()
    setSlashQuery(null)
  }, [])

  const handleComposerKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    textareaRef.current = ta
    if (mentionState !== null || slashQuery !== null) return
    if (e.key === 'ArrowUp') {
      if (ta.selectionStart !== 0 || ta.selectionEnd !== 0) return
      if (userHistory.length === 0) return
      e.preventDefault()
      if (historyIdxRef.current === -1) draftRef.current = ta.value
      const next = Math.min(historyIdxRef.current + 1, userHistory.length - 1)
      historyIdxRef.current = next
      const text = userHistory[userHistory.length - 1 - next]
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.setSelectionRange(0, 0)
    } else if (e.key === 'ArrowDown') {
      if (historyIdxRef.current === -1) return
      e.preventDefault()
      const next = historyIdxRef.current - 1
      historyIdxRef.current = next
      const text = next === -1 ? draftRef.current : userHistory[userHistory.length - 1 - next]
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.setSelectionRange(text.length, text.length)
    } else if (!['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(e.key)) {
      historyIdxRef.current = -1
    }
  }, [userHistory, mentionState, slashQuery])

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
      if (cmd?.kind === 'skill') {
        const skillMessage = parsed.args
          ? `skill: ${parsed.name}\n\n${parsed.args}`
          : `skill: ${parsed.name}`
        void sendMessage(
          { text, files },
          { body: { sessionId, message: skillMessage, model, attachments: [] } },
        )
        return
      }
      if (cmd) {
        const ctx: SlashCommandContext = {
          sessionId,
          clearMessages: () => setMessages([]),
          resetSession: () => {
            setMessages([])
            fetch(
              `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
              requestHeaders
                ? { method: 'DELETE', headers: requestHeaders }
                : { method: 'DELETE' },
            ).catch(() => {})
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
    const mentionNote = mentionedFiles.length > 0
      ? `@files: ${mentionedFiles.join(', ')}`
      : null
    const serverMessage = [
      text.trim(),
      ...(attachmentSummaries.length > 0 ? [attachmentSummaries.join('\n\n')] : []),
      ...(mentionNote ? [mentionNote] : []),
    ].filter(Boolean).join('\n\n') || text
    setMentionedFiles([])

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
          // Only forward thinkingLevel when the host opted in. The server
          // schema treats it as optional; omitting it keeps the existing
          // 'off' default behaviour for hosts that don't expose the toggle.
          ...(thinkingControl ? { thinkingLevel } : {}),
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
    <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
    <div
      data-boring-agent=""
      data-boring-agent-part="chat"
      className={cn(
        "flex h-full min-h-0 overflow-hidden text-foreground antialiased",
        debug ? "flex-row" : "flex-col",
        chrome
          ? "bg-[color:var(--canvas)] text-[13px]"
          : "bg-transparent text-[13px]",
        className,
      )}
      role="region"
      aria-label="Agent assistant"
    >
      <div className={cn("flex min-h-0 min-w-0 flex-col", debug ? "flex-1" : "h-full")}>
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden",
          chrome &&
            "mx-3 my-3 rounded-xl bg-[color:var(--surface-chat)] shadow-[0_1px_0_oklch(0_0_0/0.02),0_1px_2px_-1px_oklch(0_0_0/0.04),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.6)]",
        )}
      >
      {/* Indeterminate progress strip — visible whenever the agent is in
          flight (waiting for first byte, streaming text, running a tool).
          Top of the chat surface so it's the first thing the eye registers.
          Self-contained via motion/react so consumers don't need to import
          a separate stylesheet for the keyframes. */}
      {isStreaming && (
        <div
          className="relative h-[2px] w-full shrink-0 overflow-hidden bg-[oklch(from_var(--accent)_l_c_h/0.08)]"
          role="progressbar"
          aria-busy="true"
          aria-label="Agent working"
        >
          <motion.div
            className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent"
            initial={{ x: '-100%' }}
            animate={{ x: '400%' }}
            transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1], repeat: Infinity }}
          />
        </div>
      )}
      <Conversation className="flex-1" aria-label="Agent conversation" aria-live="polite">
        <ConversationContent className={cn(
          "mx-auto flex w-full flex-col gap-6",
          chrome ? "max-w-3xl px-6 py-8" : "max-w-[680px] px-4 py-4",
        )}>
          {messages.length === 0 && (
            <ChatEmptyState
              eyebrow={emptyEyebrow}
              title={emptyTitle}
              description={emptyDescription}
              suggestions={suggestions}
              onSelect={(s) => {
                const text = s.prompt ?? s.label
                if (!text.trim()) return
                void sendMessage(
                  { text, files: [] },
                  {
                    body: {
                      sessionId,
                      message: text,
                      model,
                      attachments: [],
                    },
                  },
                )
              }}
            />
          )}
          {messages.map((message, messageIndex) => {
            const role = message.role === 'user' || message.role === 'assistant' ? message.role : 'assistant'
            const textParts = message.parts.filter(isTextPart)
            const fileParts = message.parts.filter(isFilePart)
            const orderedParts = message.parts.reduce<Array<
              | { kind: 'reasoning'; text: string; state: ReasoningPartView['state']; key: string }
              | { kind: 'part'; part: UIMessage['parts'][number]; key: string }
            >>((items, part, index) => {
              const reasoningPart = getReasoningPart(part)
              const key = `${message.id}-${index}`
              if (!reasoningPart) {
                // Some providers emit whitespace-only text parts between
                // reasoning chunks. Treat those as separators, not real
                // content, otherwise one continuous thought renders as
                // duplicate adjacent "thoughts" widgets.
                if (!isBlankTextPart(part)) {
                  items.push({ kind: 'part', part, key })
                }
                return items
              }
              const previous = items[items.length - 1]
              if (previous?.kind === 'reasoning') {
                previous.text = `${previous.text}\n\n${reasoningPart.text}`
                if (reasoningPart.state === 'streaming') previous.state = 'streaming'
              } else {
                items.push({ kind: 'reasoning', ...reasoningPart, key })
              }
              return items
            }, [])
            // Group consecutive tool parts into a single collapsible block.
            // This collapses N separate tool cards into one "Used bash · edit"
            // line while the turn is idle, and auto-expands while tools run.
            type FinalPart =
              | (typeof orderedParts)[number]
              | { kind: 'tool-group'; tools: GroupedToolEntry[]; key: string }
            const finalParts = orderedParts.reduce<FinalPart[]>((acc, item) => {
              if (item.kind === 'part' && isToolUIPart(item.part)) {
                const prev = acc[acc.length - 1]
                if (prev?.kind === 'tool-group') {
                  prev.tools.push({ part: item.part, key: item.key })
                } else {
                  acc.push({ kind: 'tool-group', tools: [{ part: item.part, key: item.key }], key: item.key })
                }
              } else {
                acc.push(item)
              }
              return acc
            }, [])

            // Regenerate is only meaningful for the most recent assistant
            // reply — regenerating an older turn would fork history in
            // ways we don't support. Restricting visibility to the tail
            // keeps the UX honest.
            const isLastMessage = messageIndex === messages.length - 1

            return (
              <Message
                key={message.id}
                from={role}
                // Reset primitive defaults. `gap-1.5` keeps the per-message
                // action bar close but not touching; the bar itself only
                // renders on hover so idle messages stay tight.
                className="!max-w-full !gap-1.5"
              >
                <MessageContent
                  className={cn(
                    // Layout: flat container, no bubble chrome for the
                    // assistant — per .impeccable.md "the conversation is
                    // the interface": bot replies read as editorial prose
                    // on the page, not as chat-bubble UI. User messages
                    // still get a right-aligned pill so the turn
                    // structure is legible at a glance.
                    "!overflow-visible text-[13px] leading-relaxed text-foreground",
                    role === 'user'
                      ? cn(
                          "!ml-auto !max-w-[80%] !rounded-[var(--radius-lg)]",
                          "!bg-secondary !text-secondary-foreground !px-4 !py-2.5",
                        )
                      : "!w-full !bg-transparent !p-0",
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
                          <AttachmentPreview className="size-10 shrink-0 rounded-[var(--radius-md)]" />
                          <AttachmentInfo className="min-w-0 flex-1" />
                        </Attachment>
                      ))}
                    </Attachments>
                  )}

                  {/* Render reasoning + text + tool parts in the order the
                      model emitted them. Consecutive tool parts are grouped
                      into a single collapsible block that auto-expands while
                      tools run and collapses to a summary when they settle. */}
                  {finalParts.map((item, index) => {
                    if (item.kind === 'reasoning') {
                      if (!showThoughts) return null
                      return (
                        <Reasoning
                          key={`reasoning-${item.key}`}
                          isStreaming={item.state === 'streaming'}
                          defaultOpen={item.state === 'streaming'}
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{item.text}</ReasoningContent>
                        </Reasoning>
                      )
                    }
                    if (item.kind === 'tool-group') {
                      return (
                        <ToolCallGroup
                          key={item.key}
                          tools={item.tools}
                          mergedToolRenderers={mergedToolRenderers}
                        />
                      )
                    }
                    const { part } = item
                    if (isTextPart(part)) {
                      return (
                        <MessageResponse
                          key={`text-${message.id}-${index}`}
                          className={cn(
                            "max-w-none",
                            // Editorial prose rhythm — a magazine column on
                            // the page, not a log dump. Fewer type sizes,
                            // more leading; headings earn weight, not size.
                            "prose prose-invert prose-neutral",
                            "prose-p:my-3 prose-p:leading-[1.7] prose-p:text-[13px]",
                            "prose-headings:mt-5 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-[-0.01em]",
                            "prose-ul:my-3 prose-ul:pl-6 prose-ol:my-3 prose-ol:pl-6",
                            "prose-li:my-1.5 prose-li:leading-[1.7] prose-li:pl-1 prose-li:marker:text-muted-foreground/70",
                            "prose-strong:font-semibold prose-strong:text-foreground",
                            "prose-em:text-foreground/90",
                            "prose-a:text-[color:var(--accent)] prose-a:underline-offset-4 hover:prose-a:underline",
                            // Inline code chips — sit on the prose baseline.
                            "prose-code:font-mono prose-code:text-[13px] prose-code:font-medium",
                            "prose-code:rounded-[var(--radius-sm)] prose-code:border prose-code:border-border/60 prose-code:bg-muted/60",
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
                      )
                    }
                    return null
                  })}
                </MessageContent>

                {/* Per-message action bar. Lives OUTSIDE MessageContent so
                 * it doesn't reserve layout space in idle reads. `hidden`
                 * → zero height when not hovered; `group-hover:flex` +
                 * `group-focus-within:flex` reveal on interaction.
                 * Regenerate is gated to the LAST assistant message — see
                 * the regenerateLastTurn helper below for why we bypass
                 * AI SDK's built-in `regenerate()`. */}
                {role === 'assistant' && !isStreaming && textParts.length > 0 && (
                  <MessageActionsBar
                    text={textParts.map((p) => p.text).join('\n\n')}
                    canRegenerate={isLastMessage}
                    onRegenerate={() => {
                      void regenerateLastTurn({
                        messages,
                        setMessages,
                        sendMessage,
                        sessionId,
                        model,
                      })
                    }}
                  />
                )}
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
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => clearError()}
                      className="shrink-0 text-destructive/70 hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Dismiss"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </IconButton>
                  </div>
                </MessageContent>
              </Message>
            )
          })()}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className={cn(chrome ? "px-4 pb-4 pt-2 sm:px-6 sm:pb-5" : "px-3 pb-3 pt-1")}>
        <div
          className={cn(
            "mx-auto mb-2 flex w-full items-center gap-2",
            chrome ? "max-w-3xl" : "max-w-[680px]",
          )}
        >
          <div
            data-testid="chat-working"
            role="status"
            aria-live="polite"
            className={cn(
              "flex items-center gap-2 rounded-full border border-border/50 bg-background/85 px-2.5 py-1 text-[12px] text-muted-foreground/75 shadow-sm backdrop-blur",
              "transition-opacity duration-300",
              isStreaming ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            <motion.span
              aria-hidden="true"
              className="inline-block size-1.5 rounded-full bg-[color:var(--accent)]"
              animate={{ opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span>Working…</span>
          </div>
        </div>
        {attachmentNotice && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-accent/40 bg-[color:var(--accent-soft)]",
              "px-3 py-2 text-xs text-foreground",
            )}
          >
            {attachmentNotice}
          </div>
        )}
        <div className={cn("mx-auto w-full", chrome ? "max-w-3xl" : "max-w-[680px]")}>
          {mentionState && (
            <MentionPicker
              mention={mentionState}
              onSelect={selectMention}
              onDismiss={() => setMentionState(null)}
            />
          )}
          {slashQuery !== null && (
            <SlashCommandPicker
              query={slashQuery}
              commands={allCommands}
              onSelect={selectSlashCommand}
              onDismiss={() => setSlashQuery(null)}
            />
          )}
        </div>
        <div
          className={cn(
            "relative mx-auto w-full overflow-visible",
            chrome ? "max-w-3xl" : "max-w-[680px]",
            // Workspace-aligned composer surface: a flat card with an
            // inset 1px border at rest, then a focus-within swap that
            // pulls in the accent hue. No heavy drop-shadow — the pane
            // itself already has elevation, so the composer just gets a
            // subtle tonal lift.
            chrome
              ? "rounded-[var(--radius-xl)] bg-[color:var(--card)] shadow-[0_1px_2px_-1px_oklch(0_0_0/0.06),0_6px_18px_-12px_oklch(0_0_0/0.12),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)] focus-within:shadow-[0_1px_3px_-1px_oklch(0_0_0/0.08),0_10px_28px_-14px_oklch(0_0_0/0.16),inset_0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.45)] transition-shadow duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
              : // Embedded composer: visible at-rest border so the input
                // surface is identifiable when nothing has focus, then swap
                // to an accent-tinted border on focus. No card / shadow —
                // the parent surface still owns the elevation.
                "rounded-[var(--radius-xl)] bg-transparent shadow-[inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)] focus-within:shadow-[inset_0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.45)] transition-shadow duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
            // Neutralize the inner InputGroup's default border/rounded/shadow
            // so the outer surface is the only bounded container. The `!`
            // bumps these past InputGroup's own `border-input border` and
            // `shadow-xs` declarations, which otherwise win the cascade race
            // when both rules have equal class-selector specificity.
            "[&_[data-slot=input-group]]:!border-0 [&_[data-slot=input-group]]:!rounded-none",
            "[&_[data-slot=input-group]]:!shadow-none [&_[data-slot=input-group]]:!bg-transparent",
            "[&_[data-slot=input-group]]:dark:!bg-transparent [&_[data-slot=input-group]]:!ring-0",
            "[&_[data-slot=input-group]]:has-[:focus]:!ring-0",
          )}
        >
          <PromptInput
            data-boring-state={status}
            onSubmit={handleSubmit}
            multiple
            // Guard rails for the attachments pipeline. The server schema
            // caps `attachments` at 20 entries; we match that client-side and
            // add a 5 MB-per-file limit so a giant drag-drop doesn't blow
            // localStorage's ~5 MB origin quota when the cached history grows.
            maxFiles={20}
            maxFileSize={5 * 1024 * 1024}
            onError={(err) => {
              const e = err as { code: string; message?: string; max?: number }
              if (e.code === 'max_files') {
                setAttachmentNotice(`Up to ${e.max ?? 20} attachments per message.`)
              } else if (e.code === 'max_file_size') {
                const mb = e.max ? Math.round(e.max / 1024 / 1024) : 5
                setAttachmentNotice(`Files must be under ${mb} MB each.`)
              } else if (e.code === 'accept') {
                setAttachmentNotice(`That file type isn't supported here.`)
              } else {
                setAttachmentNotice(e.message || 'Attachment rejected.')
              }
            }}
          >
            <AttachmentsList />
            <PromptInputTextarea
              placeholder="Ask anything…"
              onChange={handleComposerChange}
              onKeyDown={handleComposerKeyDown}
              className={cn(
                "min-h-[52px] resize-none border-0 bg-transparent shadow-none",
                "px-5 pt-3.5 pb-1 text-[13px] leading-[1.55] placeholder:text-muted-foreground/60",
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
              {/* Spacer pushes secondary controls + submit to the right. */}
              <div className="ml-auto flex items-center gap-1">
                {thinkingControl && (
                  <>
                    <ThinkingSelect
                      value={thinkingLevel}
                      onChange={setThinkingLevel}
                      disabled={isStreaming}
                    />
                    <ThoughtVisibilityButton
                      visible={showThoughts}
                      onToggle={() => setShowThoughts((value) => !value)}
                    />
                  </>
                )}
                <div className="ml-1 flex items-center gap-2">
                  <KbdHints />
                  <PromptInputSubmit
                    status={status}
                  onStop={stop}
                  className={cn(
                    // Primary action. Uses the warm accent (not `primary`,
                    // which is a neutral foreground tone) — this is the one
                    // place the brand hue appears in the panel, so it has
                    // to earn the real estate. Becomes a Stop affordance
                    // (square icon + aria-label="Stop") while the turn
                    // streams.
                    "h-8 w-8 shrink-0 rounded-[var(--radius-md)]",
                    "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]",
                    "shadow-[0_1px_0_oklch(0_0_0/0.04),0_2px_6px_-2px_oklch(from_var(--accent)_l_c_h/0.45)]",
                    "transition-[transform,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    "hover:brightness-[1.05] active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/45",
                    "disabled:pointer-events-none disabled:opacity-40",
                    "[&>svg]:size-4",
                  )}
                  />
                </div>
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
      </div>
      </div>
      {debug && (
        <DebugDrawer
          sessionId={sessionId}
          messages={messages}
          requestHeaders={requestHeaders}
          width={debugWidth}
          onWidthChange={setDebugWidth}
        />
      )}
    </div>
    </ArtifactOpenProvider>
  )
}

/**
 * Keyboard hint chips rendered between the left-side actions and the
 * send button. Small, muted, ornamental — pure discoverability aid.
 * Hidden on narrow widths so the composer doesn't feel crowded.
 */
function KbdHints() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden items-center gap-1.5 text-[11px] text-muted-foreground/80",
        "sm:flex",
      )}
    >
      <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-sm)] border border-border/60 bg-background/60 px-1 font-mono text-[10px]">
        ↵
      </kbd>
      <span>send</span>
      <span className="text-muted-foreground/30">·</span>
      <kbd className="inline-flex h-[18px] items-center rounded-[var(--radius-sm)] border border-border/60 bg-background/60 px-1 font-mono text-[10px]">
        ⇧↵
      </kbd>
      <span>new line</span>
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
  const currentKey = encodeModelKey(value)
  // Trigger label prefers a live entry, falls back to raw id for offline /
  // legacy short-alias sessions so the label never goes blank.
  const current = options.find((m) => m.provider === value.provider && m.id === value.id)
  const triggerLabel = current?.label ?? displayModelLabel(value.id)
  const triggerProviderLabel = displayProviderLabel(value.provider)

  const availableOptions = options.filter((m) => m.available)
  const hasCurrentOption = availableOptions.some((m) => encodeModelKey(m) === currentKey)
  const menuOptions = hasCurrentOption
    ? availableOptions
    : [
        {
          provider: value.provider,
          id: value.id,
          label: triggerLabel,
          available: true,
        },
        ...availableOptions,
      ]

  // Group by provider, preserving the server's already-sorted order.
  const groups = new Map<string, AvailableModel[]>()
  for (const m of menuOptions) {
    const list = groups.get(m.provider) ?? []
    list.push(m)
    groups.set(m.provider, list)
  }

  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-boring-agent-part="model-select"
          data-boring-state={disabled ? "disabled" : undefined}
          disabled={disabled}
          aria-label="Model"
          className={cn(
            composerActionClass,
            "w-auto max-w-[min(56vw,240px)] px-2.5 text-xs font-medium",
            open && "bg-muted/60 text-foreground",
          )}
        >
          <BotIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <span className="hidden shrink-0 rounded-full border border-border/70 bg-background/45 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
            {triggerProviderLabel}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        data-boring-agent=""
        className="w-[min(92vw,360px)] rounded-lg border-border/70 bg-popover p-0 shadow-2xl"
      >
        <Command>
          <CommandInput
            placeholder="Search models…"
            className="h-9 border-0 text-[13px] focus:ring-0"
          />
          <CommandList className="max-h-[280px]">
            <CommandEmpty className="py-4 text-center text-[13px] text-muted-foreground">
              No models found
            </CommandEmpty>
            {[...groups.entries()].map(([provider, list]) => (
              <CommandGroup
                key={provider}
                heading={displayProviderLabel(provider)}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-muted-foreground/75"
              >
                {list.map((m) => {
                  const key = encodeModelKey(m)
                  const label = m.label || displayModelLabel(m.id)
                  return (
                    <CommandItem
                      key={key}
                      value={`${label} ${m.id} ${displayProviderLabel(m.provider)}`}
                      onSelect={() => { onChange(m); setOpen(false) }}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-md px-2 py-2 text-[13px]",
                        key === currentKey && "bg-foreground/[0.06]",
                      )}
                    >
                      <span className="truncate font-medium">{label}</span>
                      <span className="truncate text-[11px] text-muted-foreground">{m.id}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Med',
  high: 'High',
}

const THINKING_LEVEL_TRIGGER_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Med',
  high: 'High',
}

function ThinkingSelect({
  value,
  onChange,
  disabled,
}: {
  value: ThinkingLevel
  onChange: (next: ThinkingLevel) => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isThinkingLevel(next)) onChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        data-boring-agent-part="thinking-select"
        data-boring-state={disabled ? "disabled" : undefined}
        className={cn(composerActionClass, "w-8 px-0")}
        aria-label="Thinking level"
        data-testid="thinking-select"
      >
        {THINKING_LEVELS.map((level) => (
          <span key={level} data-value={level} hidden />
        ))}
        <BrainIcon className="h-3.5 w-3.5" />
      </SelectTrigger>
      <SelectContent position="popper" side="top" align="end" data-boring-agent="" className="w-auto min-w-0 rounded-lg border-border/70 bg-popover p-2 shadow-2xl">
        <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          Think
        </div>
        <div className="flex items-center gap-1">
          {THINKING_LEVELS.map((level) => (
            <SelectItem
              key={level}
              value={level}
              className="min-w-10 justify-center rounded-md px-2 py-1.5 text-center text-xs font-medium"
            >
              {THINKING_LEVEL_LABELS[level]}
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  )
}

function ThoughtVisibilityButton({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}) {
  const Icon = visible ? EyeIcon : EyeOffIcon
  return (
    <IconButton
      type="button"
      data-boring-agent-part="thought-toggle"
      data-boring-state={visible ? "selected" : undefined}
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      className={cn(composerActionClass, "w-8")}
      aria-pressed={visible}
      aria-label={visible ? "Hide thoughts" : "Show thoughts"}
      title={visible ? "Hide thoughts" : "Show thoughts"}
    >
      <Icon className="h-3.5 w-3.5" />
    </IconButton>
  )
}

function AttachmentButton() {
  const attachments = usePromptInputAttachments()
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => attachments.openFileDialog()}
      className={cn(composerActionClass, "w-8")}
      aria-label="Attach files"
    >
      <PaperclipIcon className="h-4 w-4" />
    </IconButton>
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
 * Rewind the most recent assistant turn and re-send the user message
 * that produced it.
 *
 * We deliberately bypass AI SDK's built-in `regenerate()` because it
 * POSTs to `/api/v1/agent/chat` with `trigger: "regenerate-message"`
 * and no `message` field — our server Zod schema requires
 * `message: z.string().min(1)`, so the built-in path fails validation
 * silently and the button appears broken. Intercepting here keeps the
 * server contract narrow (one request shape: new user turn + history
 * comes from pi's server-side session store).
 *
 * Known limitation: because pi persists session history server-side,
 * re-sending adds a duplicate user turn to the store. Acceptable for
 * now — a proper fix is a server endpoint to truncate the last turn
 * before re-sending. Client history is kept clean via setMessages.
 */
function regenerateLastTurn({
  messages,
  setMessages,
  sendMessage,
  sessionId,
  model,
}: {
  messages: UIMessage[]
  setMessages: (m: UIMessage[]) => void
  sendMessage: ReturnType<typeof useAgentChat>['sendMessage']
  sessionId: string
  model: ModelSelection
}): Promise<void> | void {
  if (messages.length === 0) return
  const tail = messages[messages.length - 1]
  if (!tail || tail.role !== 'assistant') return

  // Find the immediately preceding user message — walk backwards past
  // any interleaved assistant/tool turns.
  let userIdx = -1
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx < 0) return
  const userMessage = messages[userIdx]

  const text = userMessage.parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join('\n\n')
  const files = userMessage.parts.filter(isFilePart)

  // Rewind client-visible history to before the user turn. Server-side
  // pi session store still retains it; see caveat in the doc above.
  setMessages(messages.slice(0, userIdx))

  return sendMessage(
    { text, files },
    {
      body: {
        sessionId,
        message: text || '(regenerate)',
        model,
        attachments: files?.map((f) => ({
          filename: f.filename,
          mediaType: f.mediaType,
          url: f.url,
        })) ?? [],
      },
    },
  ).then(() => undefined)
}

/**
 * Per-message action bar. Appears on assistant messages once the turn
 * has finished streaming — Copy + Regenerate, standard chat affordances.
 *
 * Rendered via `hidden` / `group-hover:flex` / `group-focus-within:flex`
 * so at rest the bar takes ZERO layout height. The old `opacity-0`
 * approach reserved space even when invisible, which made idle
 * assistant messages look like they had mysterious trailing padding
 * below the text. This pattern is called out in .impeccable.md rule #4
 * ("Reveal reserves nothing").
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
  const markCopied = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const handleCopy = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        markCopied()
        return
      } catch {
        /* fall through to legacy fallback */
      }
    }
    // Fallback for non-secure contexts (HTTP dev URLs etc.) where the
    // async Clipboard API is unavailable. document.execCommand('copy') is
    // deprecated but still supported by every shipping browser and works
    // off a temporary textarea + selection.
    if (typeof document === 'undefined') return
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    ta.select()
    try {
      const ok = document.execCommand('copy')
      if (ok) markCopied()
    } catch {
      /* nothing more we can do */
    } finally {
      document.body.removeChild(ta)
    }
  }
  const actionBtnClass = cn(
    "inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] px-1.5",
    "text-[11.5px] font-medium text-muted-foreground/55 transition-colors",
    "hover:bg-foreground/[0.04] hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40",
  )
  return (
    <div
      className={cn(
        // Always visible but quiet — discrete utility row under the
        // assistant message. Hovering an individual button bumps it
        // back to full contrast.
        "flex items-center gap-0.5 -mt-1",
      )}
    >
      <Button type="button" variant="ghost" size="xs" onClick={handleCopy} className={actionBtnClass} aria-label={copied ? 'Copied' : 'Copy message'}>
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-[color:var(--accent)]" /> : <CopyIcon className="h-3.5 w-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </Button>
      {canRegenerate && (
        <Button type="button" variant="ghost" size="xs" onClick={onRegenerate} className={actionBtnClass} aria-label="Regenerate">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          <span>Regenerate</span>
        </Button>
      )}
    </div>
  )
}
