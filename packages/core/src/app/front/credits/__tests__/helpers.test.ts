import { describe, it, expect } from 'vitest'
import { formatCreditMicros, isLowBalance, isPaymentRequiredNotice, PAYMENT_REQUIRED_ERROR_CODE } from '../helpers'

describe('formatCreditMicros', () => {
  it('formats credit micros as euros', () => {
    expect(formatCreditMicros(10_000_000, 'en-IE')).toBe('€10.00')
    expect(formatCreditMicros(1_250_000, 'en-IE')).toBe('€1.25')
    expect(formatCreditMicros(0, 'en-IE')).toBe('€0.00')
  })
  it('clamps negative/invalid to zero', () => {
    expect(formatCreditMicros(-5, 'en-IE')).toBe('€0.00')
    expect(formatCreditMicros(Number.NaN, 'en-IE')).toBe('€0.00')
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

describe('isPaymentRequiredNotice', () => {
  it('matches only the out-of-credits error code', () => {
    expect(isPaymentRequiredNotice({ errorCode: PAYMENT_REQUIRED_ERROR_CODE })).toBe(true)
    expect(isPaymentRequiredNotice({ errorCode: 'INTERNAL_ERROR' })).toBe(false)
    expect(isPaymentRequiredNotice({})).toBe(false)
  })
})

