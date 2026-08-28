import { useCallback, useEffect, useState } from 'react'
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
 * resolution refuses instead of silently rehoming the workspace. Without this
 * surface the only recovery is editing the database. Here the owner sees which
 * Agent is missing and repins the workspace to an available one.
 *
 * Mounting is *reactive*: the host route renders this only once the workspace
 * boot has already failed with DEFAULT_AGENT_TYPE_UNKNOWN_SEAT. There is no
 * speculative probe, so a healthy workspace never pays a request, never waits,
 * and never re-renders for this feature. The one fetch below runs on mount of
 * this page — i.e. only for a workspace the server has already refused — and
 * asks the single question the page cannot answer on its own: which Agents can
 * replace the missing one.
 */

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }

export interface WorkspaceDefaultAgentRecoveryProps {
  readonly workspaceId: string
  readonly apiBaseUrl?: string
  readonly requestHeaders?: Record<string, string>
  /**
   * Called once the new default is persisted. Workspace-derived props (the
   * transport agentTypeId above all) are read from a cached workspace record,
   * so the host route must re-derive them; this page only knows the write
   * succeeded.
   */
  readonly onRecovered?: (defaultAgentTypeId: string) => void
}

function recoveryEndpoint(apiBaseUrl: string | undefined): string {
  return `${apiBaseUrl?.replace(/\/$/, '') ?? ''}${WORKSPACE_DEFAULT_AGENT_ROUTE}`
}

function isDefaultAgentState(value: unknown): value is WorkspaceDefaultAgentState {
  const candidate = value as Partial<WorkspaceDefaultAgentState> | null
  return Boolean(candidate)
    && (candidate!.status === 'ok' || candidate!.status === 'unavailable')
    && Array.isArray(candidate!.availableAgents)
}

export function WorkspaceDefaultAgentRecovery({
  workspaceId,
  apiBaseUrl,
  requestHeaders,
  onRecovered,
}: WorkspaceDefaultAgentRecoveryProps) {
  const [state, setState] = useState<WorkspaceDefaultAgentState | LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const endpoint = recoveryEndpoint(apiBaseUrl)
  const headers = { ...requestHeaders, 'x-boring-workspace-id': workspaceId }
  const headersKey = JSON.stringify(headers)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void fetch(endpoint, { headers: JSON.parse(headersKey) as Record<string, string> })
      .then((response) => (response.ok ? response.json() as Promise<unknown> : null))
      .then((payload) => {
        if (cancelled) return
        setState(isDefaultAgentState(payload) ? payload : { status: 'failed' })
      })
      .catch(() => { if (!cancelled) setState({ status: 'failed' }) })
    return () => { cancelled = true }
  }, [endpoint, headersKey, reload])

  const reread = useCallback(() => setReload((run) => run + 1), [])

  if (state.status === 'loading') {
    return (
      <RecoveryShell testId="workspace-default-agent-recovery-loading">
        <ErrorState
          className="w-full max-w-lg"
          title="Checking this workspace's Agent"
          description="Reading which Agents are available…"
        />
      </RecoveryShell>
    )
  }

  if (state.status === 'failed') {
    return (
      <RecoveryShell testId="workspace-default-agent-recovery-unreachable">
        <ErrorState
          className="w-full max-w-lg"
          title="Default Agent unavailable"
          description="This workspace cannot open, and the list of Agents that could replace its default could not be read."
          actions={<Button className="min-h-[48px]" variant="outline" onClick={reread}>Try again</Button>}
        />
      </RecoveryShell>
    )
  }

  return (
    <WorkspaceDefaultAgentRecoveryPage
      state={state}
      endpoint={endpoint}
      headers={headers}
      onRecovered={(defaultAgentTypeId) => onRecovered?.(defaultAgentTypeId)}
      onStaleState={reread}
    />
  )
}

function RecoveryShell({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div
      className="flex h-screen min-h-0 items-center justify-center overflow-auto bg-background px-6 py-10 text-foreground"
      data-testid={testId}
    >
      {children}
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
    <RecoveryShell testId="workspace-default-agent-recovery">
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
              onClick={onStaleState}
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
    </RecoveryShell>
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
