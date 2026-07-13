"use client"

import * as React from 'react'
import type { ReactNode } from 'react'
import { Button, Chip, ErrorState, LoadingState } from '@hachej/boring-ui-kit'
import type { GovernanceUsageSummary } from '../usageContract.js'
import { GovernanceUsageMeters } from './GovernanceUsageMeters.js'

export type { GovernanceUsageSummary }

const DEFAULT_ENDPOINT = '/api/v1/governance/usage-summary'
const DEFAULT_CONTEXT_LABEL = 'Company context'
const DEFAULT_DESCRIPTION = 'This deployment uses admin-managed monthly model budgets, not prepaid credits.'
const MICROS_PER_EUR = 1_000_000

export interface GovernanceUsagePanelProps {
  /**
   * Label for the company-context box heading, its "(read/write)" line, and the
   * "… context paths" heading. Tenants pass their own name (e.g. "Constellation
   * context"). Defaults to "Company context".
   */
  contextLabel?: string
  /** Intro copy under the panel heading. Defaults to the credits-free budget line. */
  description?: ReactNode
  /** Route to fetch the usage summary from. Defaults to the governance plugin route. */
  endpoint?: string
  /** Override the fetch implementation (tests / non-browser hosts). */
  fetchImpl?: typeof fetch
  /** Fully override data loading; takes precedence over `endpoint`/`fetchImpl`. */
  fetchUsageSummary?: () => Promise<GovernanceUsageSummary>
  /** Section heading. */
  title?: string
  className?: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: GovernanceUsageSummary }

function formatEurMicros(micros: number | null): string {
  if (micros === null) return 'No aggregate cap'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(micros / MICROS_PER_EUR)
}

function contextAccessLabel(summary: GovernanceUsageSummary, contextLabel: string): string {
  if (summary.companyContextRules.length === 0) return 'Not enabled'
  return summary.companyContextAccess === 'readwrite' ? `${contextLabel} (read/write)` : 'Read-only allowed paths'
}

/**
 * Complete governed-usage settings panel: role, aggregate monthly cap,
 * company-context access, the per-model usage meters (reusing
 * `GovernanceUsageMeters`), and the company-context allow-rule chips. Self-fetches
 * the summary once and hands the resolved data to the embedded meters so there is
 * a single network round-trip. Renders nothing when governance is disabled.
 */
export function GovernanceUsagePanel({
  contextLabel = DEFAULT_CONTEXT_LABEL,
  description = DEFAULT_DESCRIPTION,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl,
  fetchUsageSummary,
  title = 'Usage limits',
  className,
}: GovernanceUsagePanelProps) {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' })
    try {
      const summary = fetchUsageSummary
        ? await fetchUsageSummary()
        : await fetchSummary(endpoint, fetchImpl, signal)
      if (signal?.aborted) return
      setState({ status: 'ready', summary })
    } catch (error) {
      if (signal?.aborted) return
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to load usage' })
    }
  }, [endpoint, fetchImpl, fetchUsageSummary])

  React.useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (state.status === 'loading') {
    return (
      <PanelShell title={title} description={description} className={className}>
        <LoadingState label="Loading governed model limits…" />
      </PanelShell>
    )
  }

  if (state.status === 'error') {
    return (
      <PanelShell title={title} description={description} className={className}>
        <ErrorState
          title="Couldn’t load usage limits"
          description={state.message}
          actions={<Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>}
        />
      </PanelShell>
    )
  }

  const { summary } = state
  if (!summary.enabled) return null

  // Reuse the shared meters component without a second fetch by handing it the
  // already-resolved summary.
  const metersSummary = summary
  return (
    <PanelShell title={title} description={description} className={className}>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Role" value={summary.role ?? 'Not governed'} />
        <StatCard label="Aggregate monthly cap" value={formatEurMicros(summary.aggregateCapMicros)} />
        <StatCard label={contextLabel} value={contextAccessLabel(summary, contextLabel)} />
      </div>

      <div className="mt-6">
        <GovernanceUsageMeters fetchUsageSummary={async () => metersSummary} />
      </div>

      {summary.companyContextRules.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-foreground">{contextLabel} paths</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.companyContextRules.map((rule) => (
              <Chip key={rule} className="font-mono text-muted-foreground">{rule}</Chip>
            ))}
          </div>
        </div>
      ) : null}
    </PanelShell>
  )
}

function PanelShell({
  title,
  description,
  className,
  children,
}: {
  title: string
  description: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section data-slot="governance-usage-panel" className={className}>
      <header>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-base font-medium text-foreground">{value}</div>
    </div>
  )
}

async function fetchSummary(endpoint: string, fetchImpl: typeof fetch | undefined, signal?: AbortSignal): Promise<GovernanceUsageSummary> {
  const doFetch = fetchImpl ?? fetch
  const response = await doFetch(endpoint, { credentials: 'include', signal })
  if (!response.ok) throw new Error(`Usage summary failed: HTTP ${response.status}`)
  return await response.json() as GovernanceUsageSummary
}
