import { useState } from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@hachej/boring-ui-kit'
import { Plus } from 'lucide-react'
import { formatCreditMicros, formatMinorPrice, isLowBalance } from './helpers.js'
import { useCreditBalance } from './useCreditBalance.js'

export interface CreditBalanceBadgeProps {
  /** Base URL for the credits API (default: same origin). */
  apiBaseUrl?: string
  /** Fallback enable for the add-credits action. The server's `checkoutEnabled`
   * (from /api/credits/balance) takes precedence when present. */
  buyEnabled?: boolean
  /** Poll interval for the balance, ms (default 30s). */
  pollMs?: number
  locale?: string
}

/**
 * Top-bar credit balance: a DISCRETE remaining-balance figure plus a small "+" button.
 * Clicking "+" opens a popover of fixed top-up amounts (Anthropic-style); picking one starts
 * the server-created checkout and opens it. Polls `/api/credits/balance`; hides itself when
 * credits are disabled or the user is unauthenticated.
 */
export function CreditBalanceBadge({
  apiBaseUrl = '',
  buyEnabled = false,
  pollMs = 30_000,
  locale,
}: CreditBalanceBadgeProps) {
  const { balance, hidden, buy, buying } = useCreditBalance({ apiBaseUrl, pollMs })
  const [open, setOpen] = useState(false)

  if (hidden || !balance) return null

  const inDebt = (balance.debtMicros ?? 0) > 0
  const low = inDebt || isLowBalance(balance.remainingMicros)
  // Prefer server truth over the build-time flag so the action can't drift.
  const showBuy = balance.checkoutEnabled ?? buyEnabled
  // Fixed packs only (custom pay-what-you-want is not offered).
  const packs = (balance.packs ?? []).filter((p) => !p.custom)

  const pick = async (packId?: string) => {
    setOpen(false)
    await buy(packId)
  }

  return (
    <div className="inline-flex items-center gap-1.5" data-low={low ? 'true' : 'false'} data-debt={inDebt ? 'true' : 'false'}>
      {/* Discrete: small, muted, tabular; only colors up when low / in debt. */}
      <span
        title={inDebt ? 'Amount owed — top up to resume' : 'Remaining credits'}
        className={`text-[11px] tabular-nums ${low ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {inDebt ? `−${formatCreditMicros(balance.debtMicros, locale)}` : formatCreditMicros(balance.remainingMicros, locale)}
      </span>
      {showBuy ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Add credits"
              disabled={buying}
              className="size-5 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1.5">
            <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Add credits</p>
            {packs.length > 0 ? (
              <div className="flex flex-col">
                {packs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void pick(p.id)}
                    disabled={buying}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted disabled:opacity-50"
                  >
                    <span className="tabular-nums font-medium">{formatMinorPrice(p.priceMinor, p.currency, locale)}</span>
                    <span className="text-[11px] text-muted-foreground">{formatCreditMicros(p.creditMicros, locale)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void pick()}
                disabled={buying}
                className="w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50"
              >
                {buying ? 'Opening…' : 'Buy credits'}
              </button>
            )}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
