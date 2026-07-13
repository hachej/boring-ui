// Wire contract shared by the governance server route and the front
// GovernanceUsageMeters component. Types only — no runtime, no node imports —
// so it is safe to bundle into both the front and server build entries.

export interface GovernanceUsageEntry {
  /** Provider id (empty string for the synthetic aggregate row). */
  provider: string
  /** Model id, or "__all__" for the aggregate ("All models") row. */
  id: string
  /** Human-facing label. */
  label: string
  /** Settled spend in micros for the current period. */
  usedMicros: number
  /** In-flight held spend in micros for the current period. */
  heldMicros: number
  /** Configured cap in micros, or null when no cap is configured. */
  budgetMicros: number | null
  /** Remaining micros (max(0, budget - used - held)), or null when no cap. */
  remainingMicros: number | null
  /** Percentage of the cap consumed (0..100), or null when no cap. */
  pctUsed: number | null
  /** ISO timestamp of the budget-period reset boundary. */
  resetsAt: string
}

export interface GovernanceUsageSummary {
  /** Whether governance is enabled for this host. */
  enabled: boolean
  /** Currency of the underlying budgets. */
  currency: 'EUR'
  /** Per-model usage rows for the caller's allowed models. */
  models: GovernanceUsageEntry[]
  /** Aggregate ("All models") row when an aggregate cap is configured, else null. */
  aggregate: GovernanceUsageEntry | null
}
