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
  const { buy, buying, balance } = useCreditBalance({ apiBaseUrl, pollMs: 60_000 })
  // Wait for a loaded balance before offering the action: buy() captures a pre-checkout
  // baseline from the loaded balance, and we only show the button when checkout is wired.
  // (Balance loads on mount within one fetch.)
  if (!balance || balance.checkoutEnabled === false) return null
  return (
    <Button type="button" size="sm" onClick={() => void buy()} disabled={buying} className="shrink-0">
      {buying ? 'Opening…' : label}
    </Button>
  )
}
