import './app.css'
import { useEffect, useState } from 'react'
import { Showcase } from './Showcase'
import { ChatPanel, useSessions } from '@boring/agent/front'
import type { SessionSummary } from '@boring/agent/shared'

function Playground() {
  const sessions = useSessions()
  const [chrome, setChrome] = useState(true)
  const [thinkingControl, setThinkingControl] = useState(true)
  const [suggestions, setSuggestions] = useState<'default' | 'none'>('default')
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'showcase'>('chat')

  return (
    <div data-boring-agent="" className="flex h-screen w-screen flex-col bg-[color:var(--canvas)]">
      <SessionBar
        sessions={sessions}
        onToggleSystemPrompt={() => setSystemPromptOpen((v) => !v)}
        systemPromptOpen={systemPromptOpen}
        tab={tab}
        onTabChange={setTab}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tab === 'showcase' ? (
          <div className="min-w-0 flex-1 overflow-auto">
            <Showcase />
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              {sessions.activeSessionId ? (
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
          </>
        )}
      </div>
      {tab === 'chat' && (
        <Knobs
          chrome={chrome} setChrome={setChrome}
          thinkingControl={thinkingControl} setThinkingControl={setThinkingControl}
          suggestions={suggestions} setSuggestions={setSuggestions}
        />
      )}
    </div>
  )
}

function SessionBar({
  sessions, onToggleSystemPrompt, systemPromptOpen, tab, onTabChange,
}: {
  sessions: ReturnType<typeof useSessions>
  onToggleSystemPrompt: () => void
  systemPromptOpen: boolean
  tab: 'chat' | 'showcase'
  onTabChange: (t: 'chat' | 'showcase') => void
}) {
  const handleCreate = async () => { try { await sessions.create() } catch { /* noop */ } }
  const handleDelete = async () => {
    if (!sessions.activeSessionId) return
    if (!confirm('Delete this session?')) return
    try { await sessions.delete(sessions.activeSessionId) } catch {}
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-[color:var(--canvas)] px-3 py-2 text-[12px]">
      <div className="flex items-center gap-0.5 rounded-md border border-border/50 p-0.5">
        <button type="button" onClick={() => onTabChange('chat')}
          className={`h-6 rounded px-2.5 text-[11px] transition-colors ${tab === 'chat' ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          chat
        </button>
        <button type="button" onClick={() => onTabChange('showcase')}
          className={`h-6 rounded px-2.5 text-[11px] transition-colors ${tab === 'showcase' ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          showcase
        </button>
      </div>
      {tab === 'chat' && (
        <>
          <span className="font-medium text-muted-foreground">Session</span>
          <select
            className="h-7 rounded-md border border-border/50 bg-transparent px-2 text-[12px] outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
            value={sessions.activeSessionId ?? ''}
            onChange={(e) => sessions.switch(e.target.value)}
            disabled={sessions.loading || sessions.sessions.length === 0}
          >
            {sessions.sessions.length === 0 && <option value="">— none —</option>}
            {sessions.sessions.map((s: SessionSummary) => (
              <option key={s.id} value={s.id}>{s.title || s.id.slice(0, 8)}</option>
            ))}
          </select>
          <button type="button" onClick={handleCreate}
            className="h-7 rounded-md border border-border/50 bg-transparent px-2 text-[12px] hover:bg-muted/40">
            + new
          </button>
          <button type="button" onClick={handleDelete} disabled={!sessions.activeSessionId}
            className="h-7 rounded-md border border-border/50 bg-transparent px-2 text-[12px] hover:bg-destructive/10 hover:text-destructive disabled:opacity-40">
            − delete
          </button>
          {sessions.error && <span className="ml-2 text-destructive">{sessions.error.message}</span>}
          <button type="button" onClick={onToggleSystemPrompt} disabled={!sessions.activeSessionId}
            aria-pressed={systemPromptOpen}
            className="ml-auto h-7 rounded-md border border-border/50 bg-transparent px-2 text-[12px] hover:bg-muted/40 disabled:opacity-40 aria-pressed:bg-muted/60 aria-pressed:text-foreground">
            system prompt
          </button>
        </>
      )}
      <span className={`font-mono text-[11px] text-muted-foreground/70 ${tab === 'chat' ? '' : 'ml-auto'}`}>@boring/agent · playground</span>
    </div>
  )
}

function SystemPromptDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; text: string }
    | { kind: 'empty'; reason: string }
    | { kind: 'error'; reason: string }
  >({ kind: 'loading' })

  useEffect(() => {
    let aborted = false
    setState({ kind: 'loading' })
    fetch(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/system-prompt`)
      .then(async (res) => {
        if (aborted) return
        if (res.ok) {
          const payload = await res.json() as { systemPrompt?: string }
          if (typeof payload.systemPrompt === 'string') { setState({ kind: 'ok', text: payload.systemPrompt }); return }
          setState({ kind: 'error', reason: 'malformed response' }); return
        }
        const payload = await res.json().catch(() => null) as { error?: { message?: string } } | null
        const reason = payload?.error?.message ?? `HTTP ${res.status}`
        if (res.status === 404) setState({ kind: 'empty', reason })
        else setState({ kind: 'error', reason })
      })
      .catch((err) => { if (!aborted) setState({ kind: 'error', reason: err instanceof Error ? err.message : String(err) }) })
    return () => { aborted = true }
  }, [sessionId])

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-border/60 bg-[color:var(--canvas)]">
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">System prompt</span>
        <button type="button" onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted/60" aria-label="Close">×</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {state.kind === 'loading' && <p className="text-[12px] text-muted-foreground">Loading…</p>}
        {state.kind === 'empty' && <p className="text-[12px] text-muted-foreground">{state.reason}</p>}
        {state.kind === 'error' && <p className="text-[12px] text-destructive">{state.reason}</p>}
        {state.kind === 'ok' && (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">{state.text}</pre>
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
        <p className="text-sm text-muted-foreground">{loading ? 'Loading sessions…' : 'No active session.'}</p>
        <button type="button" onClick={onCreate} disabled={loading}
          className="rounded-md border border-border/60 bg-transparent px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50">
          Create a session
        </button>
      </div>
    </div>
  )
}

const PANEL_STORAGE_KEYS = ['boring-agent:composer:model', 'boring-agent:composer:thinking', 'boring-agent:activeSessionId'] as const

function clearAgentStorage(): void {
  try {
    for (const key of PANEL_STORAGE_KEYS) localStorage.removeItem(key)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith('boring-agent:messages:')) localStorage.removeItem(k)
    }
  } catch { /* noop */ }
}

function Knobs({ chrome, setChrome, thinkingControl, setThinkingControl, suggestions, setSuggestions }: {
  chrome: boolean; setChrome: (v: boolean) => void
  thinkingControl: boolean; setThinkingControl: (v: boolean) => void
  suggestions: 'default' | 'none'; setSuggestions: (v: 'default' | 'none') => void
}) {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 rounded-md border border-border/60 bg-[color:var(--canvas)]/95 px-3 py-1.5 text-[11px] font-medium shadow-md backdrop-blur">
        knobs
      </button>
    )
  }
  return (
    <div className="fixed right-4 bottom-4 w-56 rounded-lg border border-border/60 bg-[color:var(--canvas)]/95 p-3 text-[11px] shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-[0.1em] text-muted-foreground">Knobs</span>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted/60" aria-label="Hide knobs">×</button>
      </div>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>chrome</span>
        <input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>thinkingControl</span>
        <input type="checkbox" checked={thinkingControl} onChange={(e) => setThinkingControl(e.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>suggestions</span>
        <select className="rounded border border-border/60 bg-transparent px-1 py-0.5 text-[11px]"
          value={suggestions} onChange={(e) => setSuggestions(e.target.value as 'default' | 'none')}>
          <option value="default">default</option>
          <option value="none">[]</option>
        </select>
      </label>
      <div className="mt-2 border-t border-border/50 pt-2">
        <button type="button"
          onClick={() => { if (!confirm('Clear panel storage?')) return; clearAgentStorage(); location.reload() }}
          className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[11px] hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40">
          clear storage + reload
        </button>
      </div>
    </div>
  )
}

export function App() {
  // Apply OS color scheme to <html> for the whole app — both playground and showcase.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (dark: boolean) => document.documentElement.classList.toggle('dark', dark)
    apply(mq.matches)
    const handler = (e: MediaQueryListEvent) => apply(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return <Playground />
}
