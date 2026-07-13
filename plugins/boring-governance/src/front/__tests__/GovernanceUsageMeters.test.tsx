// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { GovernanceUsageMeters } from '../GovernanceUsageMeters.js'
import type { GovernanceUsageSummary } from '../../usageContract.js'

const RESETS_AT = '2026-08-01T00:00:00.000Z'

function summary(overrides: Partial<GovernanceUsageSummary> = {}): GovernanceUsageSummary {
  return {
    enabled: true,
    currency: 'EUR',
    aggregate: {
      provider: '', id: '__all__', label: 'All models',
      usedMicros: 2_500_000, heldMicros: 0, budgetMicros: 20_000_000,
      remainingMicros: 17_500_000, pctUsed: 13, resetsAt: RESETS_AT,
    },
    models: [
      { provider: 'infomaniak', id: 'qwen', label: 'qwen', usedMicros: 2_000_000, heldMicros: 500_000, budgetMicros: 5_000_000, remainingMicros: 2_500_000, pctUsed: 50, resetsAt: RESETS_AT },
      { provider: 'openai', id: 'gpt-5.5', label: 'gpt-5.5', usedMicros: 0, heldMicros: 0, budgetMicros: 10_000_000, remainingMicros: 10_000_000, pctUsed: 0, resetsAt: RESETS_AT },
    ],
    ...overrides,
  }
}

describe('GovernanceUsageMeters', () => {
  it('renders a meter row per model plus the aggregate with correct % and reset text', async () => {
    render(<GovernanceUsageMeters fetchUsageSummary={async () => summary()} />)

    await waitFor(() => expect(screen.getByText('All models')).toBeInTheDocument())
    expect(screen.getByText('qwen')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.5')).toBeInTheDocument()

    expect(screen.getByText('50% used')).toBeInTheDocument()
    expect(screen.getByText('0% used')).toBeInTheDocument()
    expect(screen.getByText('13% used')).toBeInTheDocument()

    // One progressbar per row (aggregate + 2 models), value reflects pctUsed.
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(3)
    expect(bars.some((bar) => bar.getAttribute('aria-valuenow') === '50')).toBe(true)

    expect(screen.getAllByText(/Resets Aug 1/).length).toBeGreaterThan(0)
  })

  it('shows an empty state when there are no rows', async () => {
    render(<GovernanceUsageMeters fetchUsageSummary={async () => summary({ aggregate: null, models: [] })} />)
    await waitFor(() => expect(screen.getByText('No usage caps configured')).toBeInTheDocument())
  })

  it('renders nothing when governance is disabled', async () => {
    const { container } = render(
      <GovernanceUsageMeters fetchUsageSummary={async () => summary({ enabled: false, aggregate: null, models: [] })} />,
    )
    await waitFor(() => expect(container.querySelector('[data-slot="governance-usage-meters"]')).toBeNull())
  })

  it('shows a loading state before data resolves', () => {
    render(<GovernanceUsageMeters fetchUsageSummary={() => new Promise<GovernanceUsageSummary>(() => {})} />)
    expect(screen.getByText('Loading usage…')).toBeInTheDocument()
  })

  it('shows an error state when loading fails', async () => {
    render(<GovernanceUsageMeters fetchUsageSummary={vi.fn(async () => { throw new Error('boom') })} />)
    await waitFor(() => expect(screen.getByText('Couldn’t load usage')).toBeInTheDocument())
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
