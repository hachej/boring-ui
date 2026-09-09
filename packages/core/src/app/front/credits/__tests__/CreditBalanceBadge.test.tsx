// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreditBalanceBadge } from '../CreditBalanceBadge.js'
import { useCreditBalance } from '../useCreditBalance.js'

vi.mock('../useCreditBalance.js', () => ({ useCreditBalance: vi.fn() }))

const useCreditBalanceMock = vi.mocked(useCreditBalance)

afterEach(() => {
  vi.clearAllMocks()
})

describe('CreditBalanceBadge', () => {
  it('shows spendable credits instead of balance reserved by active runs', () => {
    useCreditBalanceMock.mockReturnValue({
      balance: {
        enabled: true,
        userId: 'user-1',
        grantedMicros: 3_000_000,
        usedMicros: 750_000,
        remainingMicros: 2_250_000,
        activeReservedMicros: 2_200_000,
        availableMicros: 50_000,
        debtMicros: 0,
        checkoutEnabled: false,
        currency: 'credits',
      },
      hidden: false,
      error: null,
      refresh: vi.fn(),
      refreshWithRetry: vi.fn(),
      buy: vi.fn(),
      buying: false,
      lastUpdatedAt: Date.now(),
      updating: false,
    })

    render(<CreditBalanceBadge locale="en-US" />)

    const balance = screen.getByTitle(/€0\.05 available/)
    expect(balance).toHaveTextContent('€0.05')
    expect(balance).toHaveAttribute('title', expect.stringContaining('€2.25 remaining'))
    expect(balance).toHaveAttribute('title', expect.stringContaining('€2.20 reserved by active runs'))
    expect(balance.parentElement).toHaveAttribute('data-low', 'true')
  })
})
