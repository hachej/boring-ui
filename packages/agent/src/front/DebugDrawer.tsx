import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { cn } from './lib'
import { Button, IconButton, Tabs, TabsContent, TabsList, TabsTrigger } from '@hachej/boring-ui-kit'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  RefreshCwIcon,
} from 'lucide-react'

type Tab = 'session' | 'prompt' | 'messages'

// ---- session tab ----

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    if (!writeText) return
    void writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }, [value])

  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onCopy}
      className="text-muted-foreground/60"
      aria-label={label}
      title={label}
    >
      {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
    </IconButton>
  )
}

function DebugValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
          {label}
        </span>
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
      <code className="block break-all font-mono text-[11px] leading-relaxed text-foreground dark:text-zinc-100">
        {value}
      </code>
    </div>
  )
}

function SessionTab({ sessionId }: { sessionId: string }) {
  const resumeCommand = `pi --session ${sessionId}`

  return (
    <div className="flex flex-col gap-3 overflow-auto p-3 text-[11px] text-muted-foreground">
      <p>
        This web chat is backed by a pi session. Use the id below from the
        workspace root to resume the same conversation in a terminal.
      </p>
      <DebugValue label="Pi session id" value={sessionId} />
      <DebugValue label="Resume command" value={resumeCommand} />
      <p className="rounded-md border border-border/30 bg-muted/10 p-2 text-[10px] leading-relaxed text-muted-foreground/75">
        Tip: <code className="font-mono text-foreground/80">pi --continue</code>{' '}
        opens the most recent session for the current working directory. The
        explicit command above targets this session directly.
      </p>
    </div>
  )
}

// ---- system prompt tab ----

const RETRY_DELAY_MS = 2500
const MAX_RETRIES = 20

function SystemPromptTab({
  sessionId,
  requestHeaders,
}: {
  sessionId: string
  requestHeaders?: Record<string, string>
}) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; text: string }
    | { kind: 'empty'; reason: string }
    | { kind: 'error'; reason: string }
  >({ kind: 'loading' })
  const [retryKey, setRetryKey] = useState(0)
  const retryCount = useRef(0)

  const refresh = useCallback(() => {
    retryCount.current = 0
    setRetryKey((k) => k + 1)
  }, [])

  useEffect(() => {
    let aborted = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    setState({ kind: 'loading' })

    const opts = requestHeaders ? { headers: requestHeaders } : undefined
    fetch(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/system-prompt`, opts)
      .then(async (res) => {
        if (aborted) return
        if (res.ok) {
          const payload = await res.json() as { systemPrompt?: string }
          if (typeof payload.systemPrompt === 'string') {
            retryCount.current = 0
            setState({ kind: 'ok', text: payload.systemPrompt })
            return
          }
        }
        const payload = await res.json().catch(() => null) as { error?: { message?: string } } | null
        const reason = payload?.error?.message ?? `HTTP ${res.status}`
        if (res.status === 404 && retryCount.current < MAX_RETRIES) {
          setState({ kind: 'empty', reason })
          retryTimer = setTimeout(() => {
            if (!aborted) {
              retryCount.current++
              setRetryKey((k) => k + 1)
            }
          }, RETRY_DELAY_MS)
        } else {
          setState(res.status === 404 ? { kind: 'empty', reason } : { kind: 'error', reason })
        }
      })
      .catch((err) => {
        if (!aborted) setState({ kind: 'error', reason: err instanceof Error ? err.message : String(err) })
      })

    return () => {
      aborted = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [sessionId, requestHeaders, retryKey])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between px-3 pt-2 pb-1 border-b border-border/40">
        <span className="text-[10px] text-muted-foreground/80 font-mono">
          {state.kind === 'ok'
            ? `${state.text.length.toLocaleString()} chars`
            : state.kind === 'loading'
            ? 'loading…'
            : state.kind === 'empty'
            ? `waiting for session · retry ${retryCount.current}/${MAX_RETRIES}`
            : 'error'}
        </span>
        {state.kind !== 'loading' && (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={refresh}
            className="text-muted-foreground/60"
            aria-label="Refresh system prompt"
          >
            <RefreshCwIcon className="h-3 w-3" />
          </IconButton>
        )}
      </div>
      {(state.kind === 'loading' || state.kind === 'empty') && (
        <p className="text-[11px] text-muted-foreground p-3">
          {state.kind === 'loading' ? 'Loading…' : state.reason}
        </p>
      )}
      {state.kind === 'error' && (
        <p className="text-[11px] text-destructive p-3">{state.reason}</p>
      )}
      {state.kind === 'ok' && (
        <pre className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {state.text}
        </pre>
      )}
    </div>
  )
}

// ---- messages tab — flat parts list ----

function partSummary(part: unknown): string {
  const p = part as Record<string, unknown>
  const type = (p?.type as string) ?? '?'
  if (type === 'text') {
    const text = String(p.text ?? '')
    return text.slice(0, 80) + (text.length > 80 ? '…' : '')
  }
  if (type === 'tool-invocation') {
    const inv = p.toolInvocation as Record<string, unknown> | undefined
    const state = String(inv?.state ?? '')
    return `${inv?.toolName ?? '?'}() · ${state}`
  }
  if (type === 'reasoning') {
    const text = String(p.text ?? p.reasoning ?? '')
    return text.slice(0, 80) + (text.length > 80 ? '…' : '')
  }
  return type
}

interface FlatPart {
  msgId: string
  msgIndex: number
  role: string
  time: string | null
  partIndex: number
  partType: string
  part: unknown
}

function flattenMessages(messages: UIMessage[]): FlatPart[] {
  const out: FlatPart[] = []
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi]
    const msgAny = msg as UIMessage & { createdAt?: Date | string }
    const time = msgAny.createdAt
      ? new Date(msgAny.createdAt).toISOString().slice(11, 23)
      : null
    for (let pi = 0; pi < msg.parts.length; pi++) {
      const part = msg.parts[pi] as Record<string, unknown>
      out.push({
        msgId: msg.id,
        msgIndex: mi,
        role: msg.role,
        time,
        partIndex: pi,
        partType: (part?.type as string) ?? 'unknown',
        part,
      })
    }
  }
  return out
}

function MessagesTab({ messages }: { messages: UIMessage[] }) {
  const parts = flattenMessages(messages)
  const [expanded, setExpanded] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCount = useRef(parts.length)

  useEffect(() => {
    if (parts.length !== prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      prevCount.current = parts.length
    }
  }, [parts.length])

  if (parts.length === 0) {
    return <p className="text-[11px] text-muted-foreground p-3">No messages yet.</p>
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-3 pt-2 pb-1 text-[10px] text-muted-foreground/80 font-mono border-b border-border/40">
        {messages.length} msg · {parts.length} parts
      </div>
      <div className="flex-1 overflow-auto">
        {parts.map((fp) => {
          const key = `${fp.msgId}:${fp.partIndex}`
          const open = expanded === key
          return (
            <div key={key} className="border-b border-border/30 last:border-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setExpanded(open ? null : key)}
                className="h-auto w-full justify-start gap-1.5 rounded-none px-2 py-1.5 text-left"
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground/40">
                  {open
                    ? <ChevronDownIcon className="h-3 w-3" />
                    : <ChevronRightIcon className="h-3 w-3" />}
                </span>
                <span className="font-mono text-[10px] shrink-0 w-20">
                  {fp.time
                    ? <span className="text-muted-foreground/60">{fp.time}</span>
                    : <span className="text-muted-foreground/30">m{fp.msgIndex}</span>}
                </span>
                <span className={cn(
                  "shrink-0 font-mono text-[10px] w-14",
                  fp.role === 'user' ? "text-accent" : "text-muted-foreground",
                )}>
                  {fp.role}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60 w-24">
                  {fp.partType}
                </span>
                <span className="flex-1 min-w-0 font-mono text-[11px] text-foreground truncate">
                  {partSummary(fp.part)}
                </span>
              </Button>
              {open && (
                <pre className="px-3 pb-2 font-mono text-[10px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words bg-muted/20">
                  {JSON.stringify(fp.part, null, 2)}
                </pre>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ---- drawer ----

const TABS: { id: Tab; label: string }[] = [
  { id: 'session', label: 'Session' },
  { id: 'prompt', label: 'System prompt' },
  { id: 'messages', label: 'Messages' },
]

const MIN_WIDTH = 280
const MAX_WIDTH = 800
const DEFAULT_WIDTH = 440

interface DebugDrawerProps {
  sessionId: string
  messages: UIMessage[]
  requestHeaders?: Record<string, string>
  width: number
  onWidthChange: (w: number) => void
}

export function DebugDrawer({ sessionId, messages, requestHeaders, width, onWidthChange }: DebugDrawerProps) {
  const [tab, setTab] = useState<Tab>('session')

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width

    const onMove = (ev: MouseEvent) => {
      // Drag left = wider, drag right = narrower
      const delta = startX - ev.clientX
      onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width, onWidthChange])

  return (
    <>
      {/* drag handle */}
      <div
        onMouseDown={onDragStart}
        className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
        aria-hidden
      />
      <aside
        style={{ width }}
        className={cn(
          "flex h-full shrink-0 flex-col border-l border-border/60",
          "bg-[oklch(from_var(--background)_calc(l-0.01)_c_h)]",
        )}
      >
        <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex shrink-0 items-center gap-0 border-b border-border/60 px-1">
            <TabsList variant="line" className="h-auto gap-0 p-0 w-full">
              {TABS.map(({ id, label }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="h-8 flex-none px-3 py-2 text-[11px] font-medium data-[state=active]:after:bg-[color:var(--accent)]"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </header>

          <TabsContent value="session" forceMount className="flex flex-col flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden">
            <SessionTab sessionId={sessionId} />
          </TabsContent>
          <TabsContent value="prompt" forceMount className="flex flex-col flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden">
            <SystemPromptTab sessionId={sessionId} requestHeaders={requestHeaders} />
          </TabsContent>
          <TabsContent value="messages" forceMount className="flex flex-col flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden">
            <MessagesTab messages={messages} />
          </TabsContent>
        </Tabs>
      </aside>
    </>
  )
}
