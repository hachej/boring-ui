import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useWorkspaceShellCapabilities } from '@hachej/boring-workspace/plugin'

interface FactoryEpicLiveEntry {
  epicKey: string
  featureName: string
  branch: string
  worktree: string
  status: 'active' | 'closed'
  orchestratorSessionId?: string
  orchestratorStatus: string | null
  pendingQuestion: { questionId: string; title?: string } | null
  beads: { open: number; closed: number }
  headSha: string | null
  kickoff?: { status: 'not-requested' | 'accepted' | 'failed'; message?: string }
}

const badgeBase: CSSProperties = {
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  lineHeight: '18px',
  padding: '0 7px',
  whiteSpace: 'nowrap',
}

const mutedBadge: CSSProperties = {
  ...badgeBase,
  background: 'color-mix(in oklch, var(--foreground) 7%, transparent)',
  color: 'var(--muted-foreground)',
}

const activeBadge: CSSProperties = {
  ...badgeBase,
  background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
  color: 'var(--accent)',
}

const gateBadge: CSSProperties = {
  ...badgeBase,
  background: 'color-mix(in oklch, var(--warning, var(--accent)) 14%, transparent)',
  color: 'var(--warning, var(--accent))',
}

function icon(path: string) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

export const factoryEpicsIcon = icon('M8 6h8M6 12h12M9 18h6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z')

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
}

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    let message = text
    try { message = (JSON.parse(text) as { message?: string }).message ?? text } catch { /* keep response text */ }
    throw new Error(message || `Factory API returned ${response.status}`)
  }
  return JSON.parse(text) as T
}

export function FactoryEpicsOverlay({ onClose }: { onClose: () => void }) {
  const shell = useWorkspaceShellCapabilities()
  const [epics, setEpics] = useState<FactoryEpicLiveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [featureName, setFeatureName] = useState('')
  const [epicKey, setEpicKey] = useState('')
  const [requestFile, setRequestFile] = useState('')
  const [keyEdited, setKeyEdited] = useState(false)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/v1/factory/epics', { signal })
      setEpics(await responseJson<FactoryEpicLiveEntry[]>(response))
      setError(null)
    } catch (nextError) {
      if ((nextError as Error).name !== 'AbortError') setError((nextError as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const interval = window.setInterval(() => void refresh(controller.signal), 10_000)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [refresh])

  const openEpic = useCallback((entry: FactoryEpicLiveEntry) => {
    if (!entry.orchestratorSessionId) return
    const result = shell.openFullChat({ agentTypeId: 'boring-orchestrator', sessionId: entry.orchestratorSessionId })
    if (!result.success) { setError(result.message); return }
    onClose()
  }, [onClose, shell])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const entry = await responseJson<FactoryEpicLiveEntry>(await fetch('/api/v1/factory/epics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          epicKey,
          featureName,
          ...(requestFile.trim() ? { requestFile: requestFile.trim() } : {}),
          start: true,
        }),
      }))
      await shell.refreshChatSessions?.()
      setFeatureName('')
      setEpicKey('')
      setRequestFile('')
      setKeyEdited(false)
      await refresh()
      if (entry.kickoff?.status === 'failed') {
        setError(`${entry.kickoff.message ?? 'Kickoff was not accepted'}. The Orchestrator session was created and is ready to retry.`)
        return
      }
      openEpic(entry)
    } catch (nextError) {
      setError((nextError as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground" aria-label="Factory epics">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <div>
          <h2 className="text-sm font-semibold">Epics</h2>
          <p className="text-[11px] text-muted-foreground">One hub, isolated worktrees</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close epics">Close</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <form onSubmit={submit} className="mb-4 space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold">New epic</h3>
            <span className="text-[10px] text-muted-foreground">starts the Orchestrator</span>
          </div>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Feature name
            <input
              value={featureName}
              onChange={(event) => { setFeatureName(event.target.value); if (!keyEdited) setEpicKey(slugify(event.target.value)) }}
              required
              placeholder="WhatsApp Channel"
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent"
            />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Epic key
            <input
              value={epicKey}
              onChange={(event) => { setKeyEdited(true); setEpicKey(slugify(event.target.value)) }}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="whatsapp-channel"
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent"
            />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Request file <span className="font-normal opacity-70">optional</span>
            <input
              value={requestFile}
              onChange={(event) => setRequestFile(event.target.value)}
              placeholder="docs/issues/1508/request.md"
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent"
            />
          </label>
          <button type="submit" disabled={submitting || !featureName.trim() || !epicKey} className="h-8 w-full rounded-md bg-foreground px-3 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {submitting ? 'Registering…' : 'Create epic'}
          </button>
        </form>

        {error ? <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        {loading ? <p className="px-1 text-xs text-muted-foreground">Loading epics…</p> : null}
        {!loading && epics.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">No epics registered yet.</p> : null}

        <div className="space-y-2">
          {epics.map((entry) => (
            <button
              key={entry.epicKey}
              type="button"
              onClick={() => openEpic(entry)}
              disabled={!entry.orchestratorSessionId}
              className="group w-full rounded-lg border border-border/70 bg-background p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30 disabled:cursor-default disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{entry.featureName}</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{entry.branch} · {entry.headSha?.slice(0, 8) ?? 'no head'}</div>
                </div>
                <span style={entry.status === 'active' ? activeBadge : mutedBadge}>{entry.status}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span style={mutedBadge}>{entry.orchestratorStatus ?? 'no session'}</span>
                {entry.pendingQuestion ? <span style={gateBadge}>gate pending</span> : null}
                <span style={mutedBadge}>{entry.beads.open} open</span>
                <span style={mutedBadge}>{entry.beads.closed} closed</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
