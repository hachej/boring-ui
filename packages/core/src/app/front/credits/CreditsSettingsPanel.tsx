import { useState } from 'react'
import {
  Button,
  DetailList,
  DetailLine,
  Notice,
  SettingsPanel,
} from '@hachej/boring-ui-kit'
import { CreditCard } from 'lucide-react'
import { formatCreditMicros, isLowBalance } from './helpers.js'
import { useCreditBalance } from './useCreditBalance.js'

export interface CreditsSettingsPanelProps {
  /** Base URL for the credits API (default: same origin). */
  apiBaseUrl?: string
  /** Credit pack id to purchase (server maps it to a Lemon Squeezy variant). */
  pack?: string
  locale?: string
}

/**
 * Account-settings "Billing & credits" panel: shows the current balance (and any
 * debt), a low-balance hint, and a "Buy credits" action that opens the Lemon
 * Squeezy hosted checkout (server-created, buyer id from the session). Renders
 * nothing when credits are disabled or the user is unauthenticated. Pair it with
 * `UserSettingsPage`'s `billing` slot.
 */
export function CreditsSettingsPanel({ apiBaseUrl = '', pack, locale }: CreditsSettingsPanelProps) {
  const { balance, hidden, buy, buying } = useCreditBalance({ apiBaseUrl, pack })
  const [buyError, setBuyError] = useState<string | null>(null)

  if (hidden || !balance) return null

  const inDebt = (balance.debtMicros ?? 0) > 0
  const low = inDebt || isLowBalance(balance.remainingMicros)
  const showBuy = balance.checkoutEnabled ?? false

  const onBuy = async () => {
    setBuyError(null)
    const error = await buy()
    if (error) setBuyError(error)
  }

  return (
    <SettingsPanel
      id="billing"
      icon={<CreditCard className="h-3.5 w-3.5" aria-hidden="true" />}
      title="Billing & credits"
      description="Your remaining AI credits and how to top up."
      footer={showBuy ? (
        <Button type="button" size="sm" onClick={() => void onBuy()} disabled={buying}>
          {buying ? 'Opening checkout…' : 'Buy credits'}
        </Button>
      ) : undefined}
    >
      <div className="space-y-4">
        {buyError && <Notice role="alert" tone="error" description={buyError} />}
        {inDebt && (
          <Notice
            role="status"
            tone="error"
            description="Your balance is negative. Top up to resume running the agent."
          />
        )}
        {!inDebt && low && (
          <Notice
            role="status"
            tone="warning"
            description="You're low on credits. Top up to avoid interruptions."
          />
        )}
        <DetailList>
          <DetailLine label="Remaining balance">
            <p style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {inDebt
                ? `−${formatCreditMicros(balance.debtMicros, locale)}`
                : formatCreditMicros(balance.remainingMicros, locale)}
            </p>
          </DetailLine>
          <DetailLine label="Used so far">
            <p style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCreditMicros(balance.usedMicros, locale)}</p>
          </DetailLine>
        </DetailList>
        <p className="text-[12px] leading-5 text-muted-foreground">
          {showBuy
            ? 'Credits are consumed as the agent runs (priced from model token usage). Buy a credit pack to top up — checkout opens in a new tab and your balance updates automatically when payment completes.'
            : 'Credits are consumed as the agent runs (priced from model token usage). Purchasing more credits is not available in this deployment yet.'}
        </p>
      </div>
    </SettingsPanel>
  )
}
