import { useState } from 'react'
import {
  Button,
  DetailList,
  DetailLine,
  Notice,
  SettingsPanel,
} from '@hachej/boring-ui-kit'
import { CreditCard } from 'lucide-react'
import {
  formatCreditMicros,
  formatMinorPrice,
  formatSignedCreditMicros,
  isLowBalance,
  type CreditPack,
} from './helpers.js'
import { useCreditBalance } from './useCreditBalance.js'
import { useCreditHistory } from './useCreditHistory.js'

export interface CreditsSettingsPanelProps {
  /** Base URL for the credits API (default: same origin). */
  apiBaseUrl?: string
  locale?: string
}

function relativeTime(iso: string, locale?: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  return new Date(then).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Account-settings "Billing & credits" panel: current balance (+ debt/low notices,
 * staleness), a pack picker → checkout, and a lazy-loaded recent-activity list.
 * Renders nothing when credits are disabled or the user is unauthenticated.
 */
export function CreditsSettingsPanel({ apiBaseUrl = '', locale }: CreditsSettingsPanelProps) {
  const { balance, hidden, error, buy, buying, lastUpdatedAt, updating } = useCreditBalance({ apiBaseUrl })
  const history = useCreditHistory(apiBaseUrl)
  const [buyError, setBuyError] = useState<string | null>(null)
  const [selectedPack, setSelectedPack] = useState<string | null>(null)

  // Hide only when credits are authoritatively unavailable (disabled / unauthenticated).
  if (hidden) return null
  // Before the first successful load, keep a panel SHELL (loading or error) rather than
  // collapsing to nothing — the Billing nav entry is registered unconditionally, so an
  // empty target would look broken.
  if (!balance) {
    return (
      <SettingsPanel
        id="billing"
        icon={<CreditCard className="h-3.5 w-3.5" aria-hidden="true" />}
        title="Billing & credits"
        description="Your remaining AI credits, how to top up, and recent activity."
      >
        {error
          ? <Notice role="alert" tone="error" description={error} />
          : <p className="text-[13px] text-muted-foreground">Loading your balance…</p>}
      </SettingsPanel>
    )
  }

  const inDebt = (balance.debtMicros ?? 0) > 0
  const low = inDebt || isLowBalance(balance.remainingMicros)
  const showBuy = balance.checkoutEnabled ?? false
  const packs: CreditPack[] = balance.packs ?? []
  // Display the balance/history in the configured purchase currency (1 credit-unit = 1
  // major unit); fall back to EUR when no purchase provider is wired.
  const currency = packs[0]?.currency ?? 'EUR'
  const activePack = selectedPack ?? packs.find((p) => p.isDefault)?.id ?? packs[0]?.id ?? null
  const activePackObj = packs.find((p) => p.id === activePack) ?? null

  const doBuy = async (pack?: string) => {
    setBuyError(null)
    const error = await buy(pack)
    if (error) setBuyError(error)
  }

  return (
    <SettingsPanel
      id="billing"
      icon={<CreditCard className="h-3.5 w-3.5" aria-hidden="true" />}
      title="Billing & credits"
      description="Your remaining AI credits, how to top up, and recent activity."
      footer={showBuy && packs.length === 0 ? (
        <Button type="button" size="sm" onClick={() => void doBuy()} disabled={buying}>
          {buying ? 'Opening checkout…' : 'Buy credits'}
        </Button>
      ) : undefined}
    >
      <div className="space-y-4">
        {buyError && <Notice role="alert" tone="error" description={buyError} />}
        {inDebt && (
          <Notice role="status" tone="error" description="Your balance is negative. Top up to resume running the agent." />
        )}
        {!inDebt && low && (
          <Notice role="status" tone="warning" description="You're low on credits. Top up to avoid interruptions." />
        )}

        <DetailList>
          <DetailLine label="Remaining balance">
            <p style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {inDebt
                ? `−${formatCreditMicros(balance.debtMicros, currency, locale)}`
                : formatCreditMicros(balance.remainingMicros, currency, locale)}
              {updating && <span className="ml-2 text-[11px] font-normal text-muted-foreground" aria-live="polite">Updating…</span>}
            </p>
          </DetailLine>
          <DetailLine label="Used so far">
            <p style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCreditMicros(balance.usedMicros, currency, locale, { highPrecision: true })}</p>
          </DetailLine>
        </DetailList>

        {/* Pack picker (#5) — accessible radio group; settings-only. */}
        {showBuy && packs.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-[12px] font-medium text-foreground">Buy credits</legend>
            <div role="radiogroup" aria-label="Credit pack" className="flex flex-wrap gap-2">
              {packs.map((p) => {
                const selected = p.id === activePack
                return (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] ${selected ? 'border-foreground' : 'border-border/60'}`}
                  >
                    <input
                      type="radio"
                      name="credit-pack"
                      value={p.id}
                      checked={selected}
                      onChange={() => setSelectedPack(p.id)}
                    />
                    {p.custom ? (
                      <span>
                        Custom
                        <span className="text-muted-foreground"> · from {formatMinorPrice(p.priceMinor, p.currency, locale)}</span>
                      </span>
                    ) : (
                      <>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatMinorPrice(p.priceMinor, p.currency, locale)}
                        </span>
                        <span className="text-muted-foreground">· {formatCreditMicros(p.creditMicros, p.currency, locale)}</span>
                      </>
                    )}
                  </label>
                )
              })}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => activePack && void doBuy(activePack)}
              disabled={buying || !activePack}
            >
              {buying
                ? 'Opening checkout…'
                : activePackObj?.custom
                  ? 'Choose amount'
                  : activePackObj
                    ? `Buy ${formatMinorPrice(activePackObj.priceMinor, activePackObj.currency, locale)}`
                    : 'Buy credits'}
            </Button>
          </fieldset>
        )}

        <p className="text-[12px] leading-5 text-muted-foreground">
          {showBuy
            ? 'Credits are consumed as the agent runs (priced from model token usage). Checkout opens in a new tab; your balance updates automatically when payment completes.'
            : 'Credits are consumed as the agent runs (priced from model token usage). Purchasing more credits is not available in this deployment yet.'}
        </p>

        {/* Recent activity (#4) — lazy-loaded on expand. */}
        <details onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && history.entries === null && !history.loading) void history.load() }}>
          <summary className="cursor-pointer text-[12px] font-medium text-foreground">Recent activity</summary>
          <div className="mt-2">
            {history.loading && <p className="text-[12px] text-muted-foreground" aria-live="polite">Loading…</p>}
            {history.error && (
              <Notice role="alert" tone="error" description="Could not load activity. Try again." />
            )}
            {!history.loading && !history.error && history.entries?.length === 0 && (
              <p className="text-[12px] text-muted-foreground">No credit activity yet.</p>
            )}
            {!history.loading && !history.error && history.entries && history.entries.length > 0 && (
              <ul className="divide-y divide-border/40">
                {history.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
                    <span className="min-w-0">
                      <span className="text-foreground">{e.description}</span>
                      <span className="ml-2 text-muted-foreground">{relativeTime(e.createdAt, locale)}</span>
                    </span>
                    <span
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                      className={e.amountMicros >= 0 ? 'text-foreground' : 'text-muted-foreground'}
                    >
                      {formatSignedCreditMicros(e.amountMicros, currency, locale, e.kind === 'usage' ? { highPrecision: true } : undefined)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        {lastUpdatedAt && (
          <p className="text-[11px] text-muted-foreground">Updated {new Date(lastUpdatedAt).toLocaleTimeString(locale)}</p>
        )}
      </div>
    </SettingsPanel>
  )
}
