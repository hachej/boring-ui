import { describe, it, expect } from 'vitest'
import { creditNetMicros, formatCreditMicros, formatSignedCreditMicros, isLowBalance, isPaymentRequiredNotice, PAYMENT_REQUIRED_ERROR_CODE } from '../helpers'

describe('formatCreditMicros', () => {
  it('defaults to euros when no currency is given', () => {
    expect(formatCreditMicros(10_000_000, undefined, 'en-IE')).toBe('€10.00')
    expect(formatCreditMicros(1_250_000, undefined, 'en-IE')).toBe('€1.25')
    expect(formatCreditMicros(0, undefined, 'en-IE')).toBe('€0.00')
  })
  it('renders the configured display currency (1 credit-unit = 1 major unit)', () => {
    expect(formatCreditMicros(10_000_000, 'CHF', 'en-CH')).toContain('10.00')
    expect(formatCreditMicros(10_000_000, 'CHF', 'de-CH')).toMatch(/CHF/)
    expect(formatCreditMicros(5_000_000, 'USD', 'en-US')).toBe('$5.00')
  })
  it('clamps negative/invalid to zero', () => {
    expect(formatCreditMicros(-5, 'EUR', 'en-IE')).toBe('€0.00')
    expect(formatCreditMicros(Number.NaN, 'EUR', 'en-IE')).toBe('€0.00')
  })
})

describe('formatSignedCreditMicros', () => {
  it('signs and renders the configured currency', () => {
    expect(formatSignedCreditMicros(10_000_000, 'CHF', 'de-CH')).toMatch(/^\+.*CHF/)
    expect(formatSignedCreditMicros(-10_000_000, 'USD', 'en-US')).toBe('−$10.00')
    expect(formatSignedCreditMicros(0, 'EUR', 'en-IE')).toBe('€0.00')
  })
})

describe('isLowBalance', () => {
  it('flags balances at/below the threshold', () => {
    expect(isLowBalance(400_000)).toBe(true)
    expect(isLowBalance(500_000)).toBe(true)
    expect(isLowBalance(600_000)).toBe(false)
    expect(isLowBalance(1_000_000, 2_000_000)).toBe(true)
  })
})

describe('creditNetMicros', () => {
  it('is remaining minus debt (so a debt-clearing top-up registers as an increase)', () => {
    expect(creditNetMicros({ remainingMicros: 1_000_000, debtMicros: 0 })).toBe(1_000_000)
    expect(creditNetMicros({ remainingMicros: 0, debtMicros: 5_000_000 })).toBe(-5_000_000)
    // remaining clamped at 0 but debt cleared → net rises from −5e6 to 0.
    expect(creditNetMicros({ remainingMicros: 0, debtMicros: 0 })).toBeGreaterThan(
      creditNetMicros({ remainingMicros: 0, debtMicros: 5_000_000 }),
    )
  })
  it('treats non-finite fields as zero', () => {
    expect(creditNetMicros({ remainingMicros: Number.NaN, debtMicros: Number.NaN })).toBe(0)
  })
})

describe('isPaymentRequiredNotice', () => {
  it('matches only the out-of-credits error code', () => {
    expect(isPaymentRequiredNotice({ errorCode: PAYMENT_REQUIRED_ERROR_CODE })).toBe(true)
    expect(isPaymentRequiredNotice({ errorCode: 'INTERNAL_ERROR' })).toBe(false)
    expect(isPaymentRequiredNotice({})).toBe(false)
  })
})

