import './app.css'
import { useEffect, useState } from 'react'
import { ChatPanel, useSessions } from '@boring/agent/front'
import type { SessionSummary } from '@boring/agent/shared'

type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'boring-agent:playground:theme'

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'light' || raw === 'dark') return raw
  } catch { /* noop */ }
  return 'dark'
}

function Playground() {
  const sessions = useSessions()
  const [chrome, setChrome] = useState(true)
  const [thinkingControl, setThinkingControl] = useState(true)
  const [suggestions, setSuggestions] = useState<'default' | 'none'>('default')
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  // Drive the .dark class on <html> so Tailwind's dark variant + the panel's
  // oklch tokens flip together. Persisted across reloads so a session stays
  // in whichever mode you last picked.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* noop */ }
  }, [theme])

  const [systemPromptOpen, setSystemPromptOpen] = useState(false)

  return (
    <div className="flex h-screen w-screen flex-col bg-[color:var(--canvas)]">
      <SessionBar
        sessions={sessions}
        onToggleSystemPrompt={() => setSystemPromptOpen((v) => !v)}
        systemPromptOpen={systemPromptOpen}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {sessions.activeSessionId ? (
            // key forces ChatPanel to remount on session switch so useAgentChat
            // re-hydrates from /messages cleanly.
            <ChatPanel
              key={sessions.activeSessionId}
              sessionId={sessions.activeSessionId}
              chrome={chrome}
              thinkingControl={thinkingControl}
              suggestions={suggestions === 'none' ? [] : undefined}
              debug={true}
              className="h-full"
            />
          ) : (
            <Empty onCreate={() => sessions.create()} loading={sessions.loading} />
          )}
        </div>
        {systemPromptOpen && sessions.activeSessionId && (
          <SystemPromptDrawer
            sessionId={sessions.activeSessionId}
            onClose={() => setSystemPromptOpen(false)}
          />
        )}
      </div>

      <Knobs
        chrome={chrome} setChrome={setChrome}
        thinkingControl={thinkingControl} setThinkingControl={setThinkingControl}
        suggestions={suggestions} setSuggestions={setSuggestions}
        theme={theme} setTheme={setTheme}
      />
    </div>
  )
}

function SessionBar({
  sessions,
  onToggleSystemPrompt,
  systemPromptOpen,
}: {
  sessions: ReturnType<typeof useSessions>
  onToggleSystemPrompt: () => void
  systemPromptOpen: boolean
}) {
  const handleCreate = async () => {
    try { await sessions.create() } catch { /* surfaced via sessions.error */ }
  }
  const handleDelete = async () => {
    if (!sessions.activeSessionId) return
    if (!confirm('Delete this session?')) return
    try { await sessions.delete(sessions.activeSessionId) } catch {}
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 py-2 text-[12px]">
      <span className="font-medium text-muted-foreground">Session</span>
      <select
        className="h-7 rounded-md border border-border/70 bg-background px-2 text-[12px] outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
        value={sessions.activeSessionId ?? ''}
        onChange={(e) => sessions.switch(e.target.value)}
        disabled={sessions.loading || sessions.sessions.length === 0}
      >
        {sessions.sessions.length === 0 && <option value="">— none —</option>}
        {sessions.sessions.map((s: SessionSummary) => (
          <option key={s.id} value={s.id}>
            {s.title || s.id.slice(0, 8)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleCreate}
        className="h-7 rounded-md border border-border/70 bg-background px-2 text-[12px] hover:bg-muted/60"
      >
        + new
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={!sessions.activeSessionId}
        className="h-7 rounded-md border border-border/70 bg-background px-2 text-[12px] hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        − delete
      </button>
      {sessions.error && (
        <span className="ml-2 text-destructive">{sessions.error.message}</span>
      )}
      <button
        type="button"
        onClick={onToggleSystemPrompt}
        disabled={!sessions.activeSessionId}
        aria-pressed={systemPromptOpen}
        className="ml-auto h-7 rounded-md border border-border/70 bg-background px-2 text-[12px] hover:bg-muted/60 disabled:opacity-40 aria-pressed:bg-muted aria-pressed:text-foreground"
      >
        system prompt
      </button>
      <span className="font-mono text-[11px] text-muted-foreground/70">
        @boring/agent · playground
      </span>
    </div>
  )
}

function SystemPromptDrawer({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; text: string }
    | { kind: 'empty'; reason: string }
    | { kind: 'error'; reason: string }
  >({ kind: 'loading' })

  // Re-fetch whenever the session changes — different sessions can have
  // different effective prompts (e.g. different model + thinking level
  // selected at instantiation time).
  useEffect(() => {
    let aborted = false
    setState({ kind: 'loading' })
    fetch(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/system-prompt`)
      .then(async (res) => {
        if (aborted) return
        if (res.ok) {
          const payload = await res.json() as { systemPrompt?: string }
          if (typeof payload.systemPrompt === 'string') {
            setState({ kind: 'ok', text: payload.systemPrompt })
            return
          }
          setState({ kind: 'error', reason: 'malformed response' })
          return
        }
        // 404 typically means the pi session hasn't been created yet
        // (the harness lazy-creates on first sendMessage).
        const payload = await res.json().catch(() => null) as { error?: { message?: string } } | null
        const reason = payload?.error?.message ?? `HTTP ${res.status}`
        if (res.status === 404) setState({ kind: 'empty', reason })
        else setState({ kind: 'error', reason })
      })
      .catch((err) => {
        if (aborted) return
        setState({ kind: 'error', reason: err instanceof Error ? err.message : String(err) })
      })
    return () => { aborted = true }
  }, [sessionId])

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-border/60 bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          System prompt
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted/60"
          aria-label="Close system prompt"
        >
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {state.kind === 'loading' && (
          <p className="text-[12px] text-muted-foreground">Loading…</p>
        )}
        {state.kind === 'empty' && (
          <p className="text-[12px] text-muted-foreground">{state.reason}</p>
        )}
        {state.kind === 'error' && (
          <p className="text-[12px] text-destructive">{state.reason}</p>
        )}
        {state.kind === 'ok' && (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
            {state.text}
          </pre>
        )}
      </div>
      {state.kind === 'ok' && (
        <footer className="shrink-0 border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground/80">
          {state.text.length.toLocaleString()} chars · session {sessionId.slice(0, 8)}
        </footer>
      )}
    </aside>
  )
}

function Empty({ onCreate, loading }: { onCreate: () => void; loading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading sessions…' : 'No active session.'}
        </p>
        <button
          type="button"
          onClick={onCreate}
          disabled={loading}
          className="rounded-md border border-border/70 bg-background px-3 py-1.5 text-sm hover:bg-muted/60 disabled:opacity-50"
        >
          Create a session
        </button>
      </div>
    </div>
  )
}

// Storage keys the panel + this playground write to. Listed once here so
// "clear storage" is honest about what it nukes — easy to keep in sync if
// the panel adds new persisted state.
const PANEL_STORAGE_KEYS = [
  'boring-agent:composer:model',
  'boring-agent:composer:thinking',
  'boring-agent:activeSessionId',
] as const

function clearAgentStorage(): void {
  try {
    for (const key of PANEL_STORAGE_KEYS) localStorage.removeItem(key)
    // The hook caches per-session message history under a prefix; sweep all.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('boring-agent:messages:')) localStorage.removeItem(k)
    }
  } catch { /* storage unavailable */ }
}

function Knobs({
  chrome, setChrome,
  thinkingControl, setThinkingControl,
  suggestions, setSuggestions,
  theme, setTheme,
}: {
  chrome: boolean; setChrome: (v: boolean) => void
  thinkingControl: boolean; setThinkingControl: (v: boolean) => void
  suggestions: 'default' | 'none'; setSuggestions: (v: 'default' | 'none') => void
  theme: Theme; setTheme: (v: Theme) => void
}) {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 rounded-md border border-border/70 bg-background/95 px-3 py-1.5 text-[11px] font-medium shadow-md backdrop-blur"
      >
        knobs
      </button>
    )
  }
  return (
    <div className="fixed right-4 bottom-4 w-56 rounded-lg border border-border/70 bg-background/95 p-3 text-[11px] shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-[0.1em] text-muted-foreground">Knobs</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted/60"
          aria-label="Hide knobs"
        >
          ×
        </button>
      </div>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>chrome</span>
        <input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>thinkingControl</span>
        <input
          type="checkbox"
          checked={thinkingControl}
          onChange={(e) => setThinkingControl(e.target.checked)}
        />
      </label>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>suggestions</span>
        <select
          className="rounded border border-border/70 bg-background px-1 py-0.5 text-[11px]"
          value={suggestions}
          onChange={(e) => setSuggestions(e.target.value as 'default' | 'none')}
        >
          <option value="default">default</option>
          <option value="none">[]</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>theme</span>
        <select
          className="rounded border border-border/70 bg-background px-1 py-0.5 text-[11px]"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="dark">dark</option>
          <option value="light">light</option>
        </select>
      </label>
      <div className="mt-2 border-t border-border/50 pt-2">
        <button
          type="button"
          onClick={() => {
            if (!confirm('Clear panel storage (model, thinking level, active session, message cache)?')) return
            clearAgentStorage()
            // Hard reload so useSessions / useAgentChat re-init from a clean slate.
            location.reload()
          }}
          className="w-full rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
        >
          clear storage + reload
        </button>
      </div>
    </div>
  )
}

export function App() {
  return <Playground />
}
