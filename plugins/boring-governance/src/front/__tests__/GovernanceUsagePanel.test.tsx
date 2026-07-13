// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { GovernanceUsagePanel } from '../GovernanceUsagePanel.js'
import type { GovernanceUsageSummary } from '../../usageContract.js'

const RESETS_AT = '2026-08-01T00:00:00.000Z'

function summary(overrides: Partial<GovernanceUsageSummary> = {}): GovernanceUsageSummary {
  return {
    enabled: true,
    currency: 'EUR',
    role: 'user',
    aggregateCapMicros: 20_000_000,
    companyContextAccess: 'readonly',
    companyContextRules: ['company/**', 'shared/handbook.md'],
    aggregate: {
      provider: '', id: '__all__', label: 'All models',
      usedMicros: 2_500_000, heldMicros: 0, budgetMicros: 20_000_000,
      remainingMicros: 17_500_000, pctUsed: 13, resetsAt: RESETS_AT,
    },
    models: [
      { provider: 'infomaniak', id: 'qwen', label: 'qwen', usedMicros: 2_000_000, heldMicros: 500_000, budgetMicros: 5_000_000, remainingMicros: 2_500_000, pctUsed: 50, resetsAt: RESETS_AT },
    ],
    ...overrides,
  }
}

describe('GovernanceUsagePanel', () => {
  it('renders role, aggregate cap, context access, embedded meters, and context path chips', async () => {
    render(<GovernanceUsagePanel fetchUsageSummary={async () => summary()} />)

    // Panel header renders immediately; the embedded meters resolve async, so
    // wait on their content (qwen) to guarantee the whole panel has settled.
    await waitFor(() => expect(screen.getByText('qwen')).toBeInTheDocument())
    expect(screen.getByText('Usage limits')).toBeInTheDocument()

    // Role + aggregate cap stat cards.
    expect(screen.getByText('Role')).toBeInTheDocument()
    expect(screen.getByText('user')).toBeInTheDocument()
    expect(screen.getByText('Aggregate monthly cap')).toBeInTheDocument()
    expect(screen.getByText('€20.00')).toBeInTheDocument()

    // Read-only context access (rules present, not readwrite).
    expect(screen.getByText('Read-only allowed paths')).toBeInTheDocument()

    // Embedded meters reused from GovernanceUsageMeters.
    expect(screen.getByText('Model usage')).toBeInTheDocument()
    // Aggregate + per-model meter rows each render a progressbar.
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0)

    // Context-path chips.
    expect(screen.getByText('company/**')).toBeInTheDocument()
    expect(screen.getByText('shared/handbook.md')).toBeInTheDocument()
  })

  it('applies the contextLabel override to heading, access line, and paths heading', async () => {
    render(
      <GovernanceUsagePanel
        contextLabel="Constellation context"
        fetchUsageSummary={async () => summary({ companyContextAccess: 'readwrite' })}
      />,
    )

    await waitFor(() => expect(screen.getByText('Constellation context (read/write)')).toBeInTheDocument())
    // Stat card heading + "… paths" heading both use the label.
    expect(screen.getByText('Constellation context')).toBeInTheDocument()
    expect(screen.getByText('Constellation context paths')).toBeInTheDocument()
  })

  it('applies a custom description', async () => {
    render(<GovernanceUsagePanel description="Custom budget copy." fetchUsageSummary={async () => summary()} />)
    await waitFor(() => expect(screen.getByText('Custom budget copy.')).toBeInTheDocument())
  })

  it('shows "No aggregate cap" and "Not enabled" when caps/rules are absent', async () => {
    render(
      <GovernanceUsagePanel
        fetchUsageSummary={async () => summary({ aggregateCapMicros: null, companyContextAccess: 'none', companyContextRules: [] })}
      />,
    )
    await waitFor(() => expect(screen.getByText('No aggregate cap')).toBeInTheDocument())
    expect(screen.getByText('Not enabled')).toBeInTheDocument()
  })

  it('renders nothing when governance is disabled', async () => {
    const { container } = render(
      <GovernanceUsagePanel fetchUsageSummary={async () => summary({ enabled: false })} />,
    )
    await waitFor(() => expect(container.querySelector('[data-slot="governance-usage-panel"]')).toBeNull())
  })

  it('shows a loading state before data resolves', () => {
    render(<GovernanceUsagePanel fetchUsageSummary={() => new Promise<GovernanceUsageSummary>(() => {})} />)
    expect(screen.getByText('Loading governed model limits…')).toBeInTheDocument()
  })

  it('shows an error state when loading fails', async () => {
    render(<GovernanceUsagePanel fetchUsageSummary={vi.fn(async () => { throw new Error('boom') })} />)
    await waitFor(() => expect(screen.getByText('Couldn’t load usage limits')).toBeInTheDocument())
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
