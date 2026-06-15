import { useState } from 'react'
import { Button } from '@hachej/boring-ui-kit'
import { useCreditBalance } from './useCreditBalance.js'

export interface BuyCreditsNoticeActionProps {
  /** Base URL for the credits API (default: same origin). */
  apiBaseUrl?: string
  label?: string
}

/**
 * Inline "Buy credits" action for a PAYMENT_REQUIRED run-rejected notice. Self-contained:
 * starts a server-created checkout (the buyer id is set server-side) on click. Renders
 * nothing once the server reports checkout is disabled, so it can't dangle a dead button.
 * Mount it from a host's renderNoticeAction (see isPaymentRequiredNotice).
 */
export function BuyCreditsNoticeAction({ apiBaseUrl = '', label = 'Buy credits' }: BuyCreditsNoticeActionProps) {
  // A longer poll than the badge: this is a transient, error-state mount, so it
  // shouldn't add a second fast poller against /balance.
  const { buy, buying, balance, hidden } = useCreditBalance({ apiBaseUrl, pollMs: 60_000 })
  const [error, setError] = useState<string | null>(null)
  // Hide when the hook says the credit UI is unavailable (401/credits disabled) — the
  // hook keeps the last balance value in that case, so `hidden` is the authoritative
  // signal (matching the badge/settings panel). Also wait for a loaded balance with
  // checkout wired: buy() captures its pre-checkout baseline from the loaded balance.
  if (hidden || !balance || balance.checkoutEnabled === false) return null

  const onBuy = async () => {
    setError(null)
    // Surface checkout failures (popup blocked, checkout-create error, no URL) inline
    // instead of silently doing nothing — matches the settings panel's behavior.
    const message = await buy()
    if (message) setError(message)
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {/* Use foreground/background (not the primary token) for the label: this notice renders
          inside the agent's [data-boring-agent] subtree, where the dark-mode `--primary-foreground`
          mis-cascades to white (its dark tokens are keyed on .dark, but the host toggles
          [data-theme="dark"]), producing a white-on-white button. foreground/background resolve
          correctly here, so the CTA stays high-contrast in both themes. */}
      <Button
        type="button"
        size="sm"
        onClick={() => void onBuy()}
        disabled={buying}
        className="bg-foreground text-background hover:bg-foreground/90"
      >
        {buying ? 'Opening…' : label}
      </Button>
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
