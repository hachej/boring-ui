import './app.css'
import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  PanelLeftClose, PanelLeft, Plus, Trash2,
  Check, ChevronDown, ChevronRight, Loader2, Terminal as TerminalIcon,
} from 'lucide-react'
import {
  ChatPanel,
  type ToolPart,
  type ToolRenderer,
} from '../../src/front-shadcn'

interface SessionSummary {
  id: string
  title?: string
  updatedAt?: string
  turnCount?: number
}

/**
 * Shadcn-styled renderer for the bash tool, inspired by the v1 chat-centered
 * ToolUseBlock + BashToolRenderer pattern:
 *   ● Bash <description>               [spinner/check]  [chevron]
 *     $ ls -la
 *     <collapsed terminal output>
 *       +12 more lines
 *
 * Uses the same visual rhythm as the reverse renderer below (header bar,
 * monospace, dim label / bright value pattern) so both custom and default
 * tool cards feel consistent.
 */
const MAX_OUTPUT_LINES = 8

function BashCard({ part }: { part: ToolPart }) {
  const input = part.input as { command?: unknown; description?: unknown } | undefined
  const output = part.output as {
    stdout?: unknown
    stderr?: unknown
    exitCode?: unknown
    content?: Array<{ text?: unknown }>
  } | null
  const command = typeof input?.command === 'string' ? input.command : ''
  const description = typeof input?.description === 'string' ? input.description : ''

  const stdout = typeof output?.stdout === 'string'
    ? output.stdout
    : (Array.isArray(output?.content)
        ? output.content
            .map((c) => (typeof c?.text === 'string' ? c.text : ''))
            .join('')
        : '')
  const stderr = typeof output?.stderr === 'string' ? output.stderr : ''
  const exitCode = typeof output?.exitCode === 'number' ? output.exitCode : null

  const hasOutput = stdout.length > 0 || stderr.length > 0
  const isError = stderr.length > 0 || (exitCode !== null && exitCode !== 0) || part.state === 'output-error'
  const isStreaming = !hasOutput && !isError && part.state !== 'output-available'

  const [expanded, setExpanded] = useState(isStreaming || !hasOutput)
  const stdoutLines = stdout ? stdout.split('\n') : []
  const overflow = stdoutLines.length > MAX_OUTPUT_LINES
  const visibleLines = expanded || !overflow ? stdoutLines : stdoutLines.slice(0, MAX_OUTPUT_LINES)

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-input/60 bg-card/70 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-input/60 bg-muted/30 px-3 py-2 text-left text-[13px] font-medium transition hover:bg-muted/50"
        aria-expanded={expanded}
      >
        <TerminalIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-foreground">Bash</span>
        {description && (
          <span className="min-w-0 truncate font-normal text-muted-foreground">{description}</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isError ? (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          )}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 px-3 py-3 font-mono text-[13px]">
          {command && (
            <div className="flex items-start gap-2 rounded-md bg-[#0b1020]/70 px-3 py-2 leading-relaxed">
              <span className="select-none text-muted-foreground/70">$</span>
              <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-foreground/90">{command}</span>
            </div>
          )}

          {hasOutput && (
            <div className="rounded-md bg-[#0b1020]/70 px-3 py-2">
              {stdout && (
                <pre className="m-0 whitespace-pre-wrap break-all leading-relaxed text-foreground/85">
                  {visibleLines.join('\n')}
                  {overflow && !expanded ? `\n  +${stdoutLines.length - MAX_OUTPUT_LINES} more lines` : ''}
                </pre>
              )}
              {stderr && (
                <pre className="m-0 mt-2 whitespace-pre-wrap break-all leading-relaxed text-destructive/90">
                  {stderr}
                </pre>
              )}
            </div>
          )}

          {exitCode !== null && exitCode !== 0 && (
            <div className="text-xs text-destructive">exit {exitCode}</div>
          )}

          {isStreaming && !hasOutput && (
            <div className="flex items-center gap-2 text-xs italic text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running command…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const bashRenderer: ToolRenderer = (part: ToolPart) => <BashCard part={part} />

const reverseRenderer: ToolRenderer = (part: ToolPart) => {
  const input = part.input as { s?: unknown } | undefined
  const inputString = typeof input?.s === 'string' ? input.s : ''
  const out = part.output as { details?: { reversed?: unknown }; content?: Array<{ text?: unknown }> } | null
  const reversed = typeof out?.details?.reversed === 'string'
    ? out.details.reversed
    : typeof out?.content?.[0]?.text === 'string'
      ? out.content[0].text
      : ''
  const running = !reversed
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-input/60 bg-card/70 shadow-sm">
      <div className="flex items-center gap-2 border-b border-input/60 bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span
          className={
            'inline-block h-1.5 w-1.5 rounded-full ' +
            (running ? 'animate-pulse bg-amber-400' : 'bg-emerald-400')
          }
        />
        <span className="font-mono">reverse</span>
        <span className="text-foreground/60">·</span>
        <span className="text-foreground/60">{running ? 'running…' : 'done'}</span>
      </div>
      <div className="grid gap-2 px-4 py-3 font-mono text-[13px]">
        {inputString && (
          <div className="flex items-baseline gap-3">
            <span className="w-14 shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">input</span>
            <span className="min-w-0 break-words text-muted-foreground">{inputString}</span>
          </div>
        )}
        {reversed && (
          <div className="flex items-baseline gap-3">
            <span className="w-14 shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">output</span>
            <span className="min-w-0 break-words font-semibold tabular-nums text-emerald-300">{reversed}</span>
          </div>
        )}
      </div>
    </div>
  )
}

const ACTIVE_SESSION_KEY = 'boring-shadcn-example:active-session'

function loadActiveSessionId(): string {
  try {
    const stored = globalThis.localStorage?.getItem(ACTIVE_SESSION_KEY)
    if (stored && stored.length > 0) return stored
  } catch { /* noop */ }
  return 'demo'
}

function formatRelative(iso?: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>(() => loadActiveSessionId())

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/agent/sessions')
      if (!res.ok) return
      const payload = await res.json()
      const list: SessionSummary[] = Array.isArray(payload) ? payload : (payload?.sessions ?? [])
      setSessions(list)
    } catch { /* noop */ }
  }, [])

  useEffect(() => { refreshSessions() }, [refreshSessions])

  useEffect(() => {
    try { globalThis.localStorage?.setItem(ACTIVE_SESSION_KEY, activeSessionId) } catch { /* noop */ }
  }, [activeSessionId])

  const handleNewSession = useCallback(async () => {
    try {
      const now = new Date()
      const title = `Chat ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      const res = await fetch('/api/v1/agent/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) return
      const created = await res.json() as SessionSummary
      setActiveSessionId(created.id)
      refreshSessions()
    } catch { /* noop */ }
  }, [refreshSessions])

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/agent/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (id === activeSessionId) {
        const remaining = sessions.filter((s) => s.id !== id)
        setActiveSessionId(remaining[0]?.id ?? 'demo')
      }
      refreshSessions()
    } catch { /* noop */ }
  }, [activeSessionId, sessions, refreshSessions])

  return (
    <div className="dark flex h-screen bg-background text-foreground">
      {sidebarOpen && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-input/70 bg-card/40 backdrop-blur-sm">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <span className="text-xs font-bold">B</span>
              </div>
              <span className="text-[15px] font-semibold tracking-tight">Conversations</span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="Hide sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={handleNewSession}
              className="group inline-flex w-full items-center gap-2.5 rounded-lg border border-input/70 bg-background/50 px-3.5 py-2.5 text-sm font-medium text-foreground shadow-sm transition hover:border-foreground/30 hover:bg-accent/40"
            >
              <Plus className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              <span>New chat</span>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Sessions">
            {sessions.length === 0 ? (
              <div className="px-4 py-4 text-sm text-muted-foreground">
                No past sessions yet. Start a new chat to see it here.
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {sessions.map((s) => {
                  const isActive = s.id === activeSessionId
                  const label = s.title && s.title.trim().length > 0 ? s.title : s.id.slice(0, 8)
                  return (
                    <li key={s.id}>
                      <div
                        className={
                          'group relative flex items-center gap-2 rounded-lg pl-3 pr-2 py-2.5 transition ' +
                          (isActive
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground')
                        }
                      >
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary/80"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveSessionId(s.id)}
                          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                        >
                          <span
                            className={
                              'w-full truncate text-[13px] leading-5 ' +
                              (isActive ? 'font-semibold' : 'font-medium')
                            }
                          >
                            {label}
                          </span>
                          {s.updatedAt && (
                            <span className="text-[12px] font-normal text-muted-foreground">
                              {formatRelative(s.updatedAt)}
                              {typeof s.turnCount === 'number' && s.turnCount > 0 ? ` · ${s.turnCount} turns` : ''}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSession(s.id)}
                          className="opacity-0 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                          aria-label={`Delete session ${label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </nav>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {!sidebarOpen && (
          <div className="border-b border-input px-3 py-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="Show sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
        )}
        <ChatPanel
          key={activeSessionId}
          sessionId={activeSessionId}
          toolRenderers={{ reverse: reverseRenderer }}
          onSessionReset={refreshSessions}
        />
      </div>
    </div>
  )
}

/**
 * Deterministic design showcase. Renders one hand-crafted conversation
 * containing every tool state + markdown pattern so we can iterate visual
 * design without any LLM in the loop. Activated via `?showcase=1`.
 */
function Showcase() {
  const messages = [
    // Scenario: one image attachment (with preview) + body text.
    {
      id: 'u0',
      role: 'user' as const,
      parts: [
        {
          type: 'file' as const,
          url: 'data:image/svg+xml;utf8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%23312e81"/><stop offset="1" stop-color="%230ea5e9"/></linearGradient></defs><rect width="240" height="160" fill="url(%23g)"/><text x="120" y="90" text-anchor="middle" font-family="Inter,system-ui" font-size="24" font-weight="700" fill="white">mockup.png</text></svg>',
          ),
          mediaType: 'image/svg+xml',
          filename: 'mockup.svg',
        } as any,
        { type: 'text' as const, text: 'Can you take a look at this mockup and suggest improvements?' },
      ],
    },
    // Assistant acknowledgement for the single image.
    {
      id: 'a0',
      role: 'assistant' as const,
      parts: [
        {
          type: 'text' as const,
          text: 'Got it — the gradient tile reads cleanly. A few quick calls: tighten the type tracking, drop the drop-shadow, and reserve an 8px safe area around the text so it breathes on small sizes.',
        },
      ],
    },
    // Scenario: multiple text attachments in one message.
    {
      id: 'u0a',
      role: 'user' as const,
      parts: [
        {
          type: 'file' as const,
          url: 'data:text/plain;base64,' + btoa('# Project notes\n\n- Ship shadcn ChatPanel\n- Wire attachments + artifacts\n- Reach 9/10\n'),
          mediaType: 'text/plain',
          filename: 'notes.md',
        } as any,
        {
          type: 'file' as const,
          url: 'data:text/plain;base64,' + btoa('id,name,status\n1,ChatPanel,shipped\n2,Tool primitive,shipped\n3,Artifact,shipped\n'),
          mediaType: 'text/csv',
          filename: 'status.csv',
        } as any,
        {
          type: 'file' as const,
          url: 'data:application/json;base64,' + btoa('{"model":"sonnet","temperature":0.2,"tools":["bash","read","write","edit"]}'),
          mediaType: 'application/json',
          filename: 'config.json',
        } as any,
        { type: 'text' as const, text: 'Three files — cross-reference the notes against the status and config, please.' },
      ],
    },
    // Assistant reply for the multi-file scenario.
    {
      id: 'a0a',
      role: 'assistant' as const,
      parts: [
        {
          type: 'text' as const,
          text: 'All three line up. `notes.md` calls for the ChatPanel, Artifact, and Attachments work; `status.csv` shows all three as shipped; and `config.json` lists the four tools the Agent pane uses. Nothing drifts between files.',
        },
      ],
    },
    // Scenario: file attachment with NO accompanying text.
    {
      id: 'u0b',
      role: 'user' as const,
      parts: [
        {
          type: 'file' as const,
          url: 'data:text/plain;base64,' + btoa('function greet(name){return `Hello, ${name}!`}\n'),
          mediaType: 'text/javascript',
          filename: 'greet.js',
        } as any,
      ],
    },
    {
      id: 'a0b',
      role: 'assistant' as const,
      parts: [
        {
          type: 'text' as const,
          text: 'Received `greet.js` — what would you like me to do with it? (refactor, add tests, document, port to TypeScript, …)',
        },
      ],
    },
    {
      id: 'u1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'Show me everything you can render.' }],
    },
    {
      id: 'a1',
      role: 'assistant' as const,
      parts: [
        {
          type: 'text' as const,
          text:
            'Here is a full tour of the renderers, covering each tool state and the common markdown patterns.\n\n' +
            '**Inline formatting:** bold, *italic*, `inline code`, ~~strike~~, and [a link](https://example.com).\n\n' +
            '### Numbered list\n' +
            '1. First option\n' +
            '2. Second option with a long explanation that should wrap cleanly inside the prose block without breaking the baseline grid.\n' +
            '3. Third option\n\n' +
            '### Block quote\n' +
            '> Design is not just what it looks like and feels like. Design is how it works.\n\n' +
            '### Code block',
        },
        {
          type: 'text' as const,
          text:
            '```ts\n' +
            '// A typed, syntax-highlighted example.\n' +
            'interface User {\n' +
            '  id: string\n' +
            '  email: string\n' +
            '  createdAt: Date\n' +
            '}\n\n' +
            'export async function loadUser(id: string): Promise<User | null> {\n' +
            '  const res = await fetch(`/api/users/${id}`)\n' +
            '  if (!res.ok) return null\n' +
            '  return (await res.json()) as User\n' +
            '}\n' +
            '```',
        },
      ],
    },
    {
      id: 'u2',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'Call the bash tool.' }],
    },
    {
      id: 'a2',
      role: 'assistant' as const,
      parts: [
        {
          type: 'dynamic-tool' as const,
          toolName: 'bash',
          toolCallId: 'tc-bash-1',
          state: 'output-available' as const,
          input: { command: 'ls -la /etc | head -6', description: 'List /etc entries' },
          output: {
            stdout: [
              'total 1024',
              'drwxr-xr-x 164 root root 12288 Apr 23 18:42 .',
              'drwxr-xr-x  25 root root  4096 Mar 14 09:10 ..',
              'drwxr-xr-x   3 root root  4096 Feb 03 11:01 X11',
              '-rw-r--r--   1 root root  3028 Jan 18 14:22 adduser.conf',
              'drwxr-xr-x   2 root root  4096 Apr 01 08:55 apparmor',
            ].join('\n'),
            stderr: '',
            exitCode: 0,
          },
        } as any,
      ],
    },
    {
      id: 'a3',
      role: 'assistant' as const,
      parts: [
        {
          type: 'dynamic-tool' as const,
          toolName: 'bash',
          toolCallId: 'tc-bash-2',
          state: 'output-error' as const,
          input: { command: 'cat /does/not/exist', description: 'Read missing file' },
          output: { stdout: '', stderr: 'cat: /does/not/exist: No such file or directory', exitCode: 1 },
        } as any,
      ],
    },
    {
      id: 'u3',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'Now read, write, edit, and a custom tool.' }],
    },
    {
      id: 'a4',
      role: 'assistant' as const,
      parts: [
        {
          type: 'dynamic-tool' as const,
          toolName: 'read',
          toolCallId: 'tc-read-1',
          state: 'output-available' as const,
          input: { path: 'src/server/greeter.ts' },
          output: {
            text: 'export function greet(name: string): string {\n  return `Hello, ${name}!`\n}\n',
          },
        } as any,
        {
          type: 'dynamic-tool' as const,
          toolName: 'write',
          toolCallId: 'tc-write-1',
          state: 'output-available' as const,
          input: { path: 'src/server/greeter.ts', content: 'export function greet(name: string): string {\n  return `Hi, ${name}.`\n}\n' },
          output: { written: 74 },
        } as any,
        {
          type: 'dynamic-tool' as const,
          toolName: 'edit',
          toolCallId: 'tc-edit-1',
          state: 'output-available' as const,
          input: {
            path: 'src/server/greeter.ts',
            oldString: 'return `Hi, ${name}.`',
            newString: 'return `Hi, ${name}! Welcome aboard.`',
          },
          output: { replaced: 1 },
        } as any,
        {
          type: 'dynamic-tool' as const,
          toolName: 'reverse',
          toolCallId: 'tc-rev-1',
          state: 'output-available' as const,
          input: { s: 'shadcn rocks' },
          output: { content: [{ type: 'text', text: 'skcor ncdahs' }], details: { reversed: 'skcor ncdahs' } },
        } as any,
      ],
    },
    {
      id: 'a5',
      role: 'assistant' as const,
      parts: [
        {
          type: 'dynamic-tool' as const,
          toolName: 'bash',
          toolCallId: 'tc-bash-3',
          state: 'input-available' as const,
          input: { command: 'pnpm test', description: 'Run the test suite' },
        } as any,
      ],
    },
    {
      id: 'a6',
      role: 'assistant' as const,
      parts: [
        {
          type: 'text' as const,
          text: 'That wraps up the tour. Every state (running, error, complete) and every tool type is in this view.',
        },
      ],
    },
  ] as any

  // Avoid running useAgentChat (would try to fetch from server). Instead
  // seed a pure ChatPanel by passing a fake sessionId and using setMessages
  // directly via a mount effect. Simplest path: call the ChatPanel but
  // intercept its useChat by using a pre-populated localStorage cache so
  // hydration restores everything.
  useEffect(() => {
    try {
      localStorage.setItem('boring-agent:messages:__showcase__', JSON.stringify(messages))
      localStorage.setItem('boring-shadcn-example:active-session', '__showcase__')
    } catch { /* noop */ }
  }, [])

  return (
    <div className="dark flex h-screen bg-background text-foreground">
      <aside className="flex w-72 shrink-0 flex-col border-r border-input/70 bg-card/40 backdrop-blur-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="text-xs font-bold">B</span>
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Conversations</span>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          <ul className="flex flex-col gap-1">
            <li>
              <div className="group relative flex items-center gap-2 rounded-lg bg-accent pl-3 pr-2 py-2.5 text-foreground">
                <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary/80" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="w-full truncate text-[13px] font-semibold leading-5">Showcase conversation</span>
                  <span className="text-[12px] text-muted-foreground">just now · 6 turns</span>
                </div>
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-muted-foreground">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="w-full truncate text-[13px] font-medium leading-5">Refactor auth middleware</span>
                  <span className="text-[12px] text-muted-foreground">12m ago · 3 turns</span>
                </div>
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-muted-foreground">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="w-full truncate text-[13px] font-medium leading-5">Design review</span>
                  <span className="text-[12px] text-muted-foreground">2h ago · 7 turns</span>
                </div>
              </div>
            </li>
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatPanel
          key="__showcase__"
          sessionId="__showcase__"
          toolRenderers={{ reverse: reverseRenderer }}
        />
      </div>
    </div>
  )
}

const params = new URLSearchParams(globalThis.location?.search ?? '')
const isShowcase = params.get('showcase') === '1'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')
createRoot(root).render(isShowcase ? <Showcase /> : <App />)
