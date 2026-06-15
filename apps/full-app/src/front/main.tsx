import { createRoot } from 'react-dom/client'
import {
  BuyCreditsNoticeAction,
  CheckoutReturnBanner,
  CoreWorkspaceAgentFront,
  CREDITS_REFRESH_EVENT,
  CreditBalanceBadge,
  CreditsSettingsPanel,
  DefaultTopBarRight,
  isPaymentRequiredNotice,
  useCreditBalance,
} from '@hachej/boring-core/app/front'
import { UserSettingsPage } from '@hachej/boring-core/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { demoFrontPlugin } from '../plugins/demo/front'

const PRODUCT_NAME = 'Seneca AI'

// Show the Buy-credits button when the server has Lemon Squeezy checkout wired
// (set this alongside the server-side LS env). The checkout itself is created
// server-side so the buyer id can't be tampered with.
const buyEnabled = import.meta.env.VITE_CREDITS_BUY_ENABLED === '1'

// Surface the current balance + a "Buy credits" action on the account settings page
// (in addition to the top-bar badge). Gate the Billing section on the same hook the
// panel uses, so the nav entry and the panel appear/disappear together — `hidden` is
// true when credits are disabled or the user is unauthenticated, where the panel would
// self-hide and otherwise leave a dangling nav link with no target.
const AccountSettingsPage = () => {
  const { hidden } = useCreditBalance()
  return (
    <UserSettingsPage
      extraSections={
        hidden
          ? []
          : [
              {
                id: 'billing',
                navLabel: 'Billing',
                navDescription: 'Credits and top-up',
                content: <CreditsSettingsPanel />,
              },
            ]
      }
    />
  )
}

// Credit-aware chat wiring — the ONLY place credits meet the agent. The agent
// exposes generic seams (a stable error code + lifecycle callbacks); here we map
// them to credit UX without the agent knowing about billing:
//  - onTurnComplete → broadcast a balance refresh so the badge updates right after
//    a run settles (credits are debited async, so the hook's retry burst polls).
//  - renderNoticeAction → attach a Buy-credits button to a PAYMENT_REQUIRED
//    run-rejected notice. Wired unconditionally: BuyCreditsNoticeAction self-hides on
//    the SERVER's checkoutEnabled, so it can't be suppressed by a missing/stale Vite
//    flag while checkout actually works (the flag only feeds the badge fallback).
const chatParams = {
  thinkingControl: true,
  onTurnComplete: () => window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT)),
  renderNoticeAction: (notice: { errorCode?: string }) =>
    isPaymentRequiredNotice(notice) ? <BuyCreditsNoticeAction /> : null,
}

createRoot(document.getElementById('root')!).render(
  <>
    <CoreWorkspaceAgentFront
      apiBaseUrl=""
      apiTimeout={10_000}
      persistenceEnabled
      appTitle={PRODUCT_NAME}
      chatEntryMode="chat-first"
      chatParams={chatParams}
      plugins={[demoFrontPlugin]}
      authPages={{ userSettings: AccountSettingsPage }}
      topBarRight={
        <>
          <CreditBalanceBadge buyEnabled={buyEnabled} />
          <DefaultTopBarRight />
        </>
      }
    />
    {/* Post-checkout return (LS redirects to ?checkout=return); confirms server-side. */}
    <CheckoutReturnBanner />
  </>,
)
