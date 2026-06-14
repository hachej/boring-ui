import { useCheckoutReturnHandler } from './useCheckoutReturnHandler.js'

export interface CheckoutReturnBannerProps {
  apiBaseUrl?: string
  /** Query param the LS redirect uses (default 'checkout'). */
  param?: string
}

const COPY: Record<string, { tone: string; text: string }> = {
  checking: { tone: 'info', text: 'Checking your payment…' },
  confirmed: { tone: 'success', text: 'Credits added — thank you!' },
  processing: { tone: 'info', text: 'Payment received — your credits are still processing and usually appear within a minute.' },
  cancelled: { tone: 'warning', text: 'Checkout cancelled — no charge was made.' },
}

/**
 * Renders the post-checkout return state (see useCheckoutReturnHandler). Mount it once
 * near the app root. It NEVER claims success from the URL — only after the server
 * balance actually increases. ARIA-live so the status is announced. Self-hides when idle.
 */
export function CheckoutReturnBanner({ apiBaseUrl = '', param }: CheckoutReturnBannerProps) {
  const { status, dismiss } = useCheckoutReturnHandler({ apiBaseUrl, ...(param ? { param } : {}) })
  if (status === 'idle') return null
  const copy = COPY[status]
  if (!copy) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={copy.tone}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 1000,
        maxWidth: 360,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 8,
        fontSize: 13,
        background: 'var(--color-surface, #fff)',
        color: 'var(--color-foreground, inherit)',
        border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      }}
    >
      <span>{copy.text}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'inherit' }}
      >
        ×
      </button>
    </div>
  )
}
