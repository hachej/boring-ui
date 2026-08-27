import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, ErrorState } from '@hachej/boring-ui-kit'
import {
  WORKSPACE_DEFAULT_AGENT_ROUTE,
  type WorkspaceDefaultAgentOption,
  type WorkspaceDefaultAgentRepinRequest,
  type WorkspaceDefaultAgentState,
} from '../../shared/workspaceDefaultAgent.js'

/**
 * gh-1402: the UX half of the fail-closed default Agent (gh-1386).
 *
 * When a workspace's persisted default names a seat that no longer exists,
 * every gated effect is refused with `default_agent_type_unknown_seat`. Without
 * this surface the only recovery is editing the database. Here the owner sees
 * which Agent is missing and repins the workspace to an available one.
 *
 * The probe is deliberately NOT a render gate on the happy path: it runs
 * alongside the workspace and swaps in only once the server has *confirmed*
 * the broken state. A healthy workspace therefore pays no boot latency, and a
 * probe that fails (offline, proxy hiccup) degrades to the normal workspace
 * rather than locking the user out of a workspace that may be fine — the
 * server, not this component, is what enforces the guarantee.
 */

export interface WorkspaceDefaultAgentRecoveryGateProps {
  readonly workspaceId: string
  readonly apiBaseUrl?: string
  readonly requestHeaders?: Record<string, string>
  /**
   * Called once the new default is persisted. Workspace-derived props (the
   * transport agentTypeId above all) are read from a cached workspace record,
   * so the host route must re-derive them; the gate itself only knows that the
   * write succeeded.
   */
  readonly onRecovered?: (defaultAgentTypeId: string) => void
  readonly children: ReactNode
}

const PROBE_RETRY_LIMIT = 2
const PROBE_RETRY_DELAY_MS = 1_500

function recoveryEndpoint(apiBaseUrl: string | undefined): string {
  return `${apiBaseUrl?.replace(/\/$/, '') ?? ''}${WORKSPACE_DEFAULT_AGENT_ROUTE}`
}

function isDefaultAgentState(value: unknown): value is WorkspaceDefaultAgentState {
  const candidate = value as Partial<WorkspaceDefaultAgentState> | null
  return Boolean(candidate)
    && (candidate!.status === 'ok' || candidate!.status === 'unavailable')
    && Array.isArray(candidate!.availableAgents)
}

export function WorkspaceDefaultAgentRecoveryGate({
  workspaceId,
  apiBaseUrl,
  requestHeaders,
  onRecovered,
  children,
}: WorkspaceDefaultAgentRecoveryGateProps) {
  // Only a *confirmed* broken workspace is ever held in state: a healthy probe
  // leaves the tree untouched, so the happy path neither waits for this request
  // nor re-renders because of it.
  const [unavailable, setUnavailable] = useState<WorkspaceDefaultAgentState | null>(null)
  // A probe that never lands is the dangerous case: the server still refuses
  // every effect, so silently doing nothing would strand the user on a
  // workspace that cannot work and offers no way out. Re-probe a bounded number
  // of times, then hand over an explicit "Check again".
  const [probeFailed, setProbeFailed] = useState(false)
  // Incremented to force a re-probe; a plain retry counter cannot, because
  // re-checking after giving up would reset it to a value it already holds and
  // React would skip the effect.
  const [probeRun, setProbeRun] = useState(0)
  const consecutiveFailures = useRef(0)
  const endpoint = recoveryEndpoint(apiBaseUrl)
  const headers = { ...requestHeaders, 'x-boring-workspace-id': workspaceId }
  const headersKey = JSON.stringify(headers)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setUnavailable(null)
    setProbeFailed(false)
    const failed = () => {
      if (cancelled) return
      consecutiveFailures.current += 1
      if (consecutiveFailures.current <= PROBE_RETRY_LIMIT) {
        retryTimer = setTimeout(
          () => { if (!cancelled) setProbeRun((run) => run + 1) },
          PROBE_RETRY_DELAY_MS * consecutiveFailures.current,
        )
        return
      }
      setProbeFailed(true)
    }
    void fetch(endpoint, { headers: JSON.parse(headersKey) as Record<string, string> })
      .then((response) => (response.ok ? response.json() as Promise<unknown> : null))
      .then((payload) => {
        if (cancelled) return
        if (!isDefaultAgentState(payload)) {
          failed()
          return
        }
        consecutiveFailures.current = 0
        if (payload.status === 'unavailable') setUnavailable(payload)
      })
      .catch(failed)
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [endpoint, headersKey, probeRun])

  const recheck = useCallback(() => {
    consecutiveFailures.current = 0
    setProbeRun((run) => run + 1)
  }, [])

  if (!unavailable) {
    return (
      <>
        {children}
        {probeFailed && <WorkspaceDefaultAgentProbeFailureNotice onRecheck={recheck} />}
      </>
    )
  }

  return (
    <WorkspaceDefaultAgentRecoveryPage
      state={unavailable}
      endpoint={endpoint}
      headers={headers}
      onRecovered={(defaultAgentTypeId) => {
        setUnavailable(null)
        onRecovered?.(defaultAgentTypeId)
      }}
      onStaleState={recheck}
    />
  )
}

/**
 * Non-blocking, because the workspace is only *probably* broken at this point:
 * the probe never landed, so refusing access outright would punish an
 * ordinary network blip. It gives the one thing the silent version lacked —
 * a way to ask again.
 */
function WorkspaceDefaultAgentProbeFailureNotice({ onRecheck }: { onRecheck: () => void }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg"
      role="status"
      data-testid="workspace-default-agent-probe-failed"
    >
      <span>
        This workspace&apos;s default Agent could not be verified. If nothing here runs, its Agent may be unavailable.
      </span>
      <Button className="min-h-[48px]" variant="outline" onClick={onRecheck}>Check again</Button>
    </div>
  )
}

function WorkspaceDefaultAgentRecoveryPage({
  state,
  endpoint,
  headers,
  onRecovered,
  onStaleState,
}: {
  state: WorkspaceDefaultAgentState
  endpoint: string
  headers: Record<string, string>
  onRecovered: (defaultAgentTypeId: string) => void
  onStaleState: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const missingAgentTypeId = state.persistedDefaultAgentTypeId ?? 'unknown'

  const confirm = useCallback(async () => {
    if (!selected) return
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        // The observed seat is part of the request: the server refuses the
        // write if it is no longer what is persisted, so a stale tab can never
        // clobber a recovery that already happened elsewhere.
        body: JSON.stringify({
          expectedDefaultAgentTypeId: missingAgentTypeId,
          defaultAgentTypeId: selected,
        } satisfies WorkspaceDefaultAgentRepinRequest),
      })
      if (response.status === 409) {
        setSaveError('This workspace was changed somewhere else. Re-reading its current state…')
        onStaleState()
        return
      }
      if (!response.ok) {
        setSaveError('That Agent could not be saved as the default. It may have just become unavailable too.')
        return
      }
      onRecovered(selected)
    } catch {
      setSaveError('The new default Agent could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }, [endpoint, headers, missingAgentTypeId, onRecovered, onStaleState, selected])

  return (
    <div
      className="flex h-screen min-h-0 items-center justify-center overflow-auto bg-background px-6 py-10 text-foreground"
      data-testid="workspace-default-agent-recovery"
    >
      <ErrorState
        className="w-full max-w-lg"
        title="Default Agent unavailable"
        description={(
          <>
            This workspace is pinned to the Agent <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">{missingAgentTypeId}</code>, which is no longer part of the fleet. Nothing will run here until you pick an Agent that is.
          </>
        )}
        actions={state.availableAgents.length > 0
          ? (
            <Button
              className="min-h-[48px] w-full sm:w-auto"
              disabled={!selected || saving}
              onClick={() => { void confirm() }}
            >
              {saving ? 'Saving…' : 'Set as default Agent'}
            </Button>
          )
          : (
            <Button
              className="min-h-[48px] w-full sm:w-auto"
              variant="outline"
              onClick={() => { window.location.reload() }}
            >
              Retry
            </Button>
          )}
      >
        {state.availableAgents.length > 0
          ? (
            <div
              className="mt-2 flex flex-col gap-2"
              role="radiogroup"
              aria-label="Available Agents"
            >
              {state.availableAgents.map((agent) => (
                <AgentChoice
                  key={agent.agentTypeId}
                  agent={agent}
                  selected={selected === agent.agentTypeId}
                  disabled={saving}
                  onSelect={() => setSelected(agent.agentTypeId)}
                />
              ))}
            </div>
          )
          : (
            <p className="text-sm text-foreground" data-testid="workspace-default-agent-recovery-empty">
              No Agents are available in this deployment, so there is nothing to pin the workspace to. An administrator has to restore an Agent before this workspace can open.
            </p>
          )}
        {saveError && (
          <p className="text-sm text-destructive" role="alert">{saveError}</p>
        )}
      </ErrorState>
    </div>
  )
}

function AgentChoice({
  agent,
  selected,
  disabled,
  onSelect,
}: {
  agent: WorkspaceDefaultAgentOption
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
        selected
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted'
      }`}
    >
      <span className="font-medium">{agent.label}</span>
      <span className="font-mono text-xs text-muted-foreground">{agent.agentTypeId}</span>
    </button>
  )
}
