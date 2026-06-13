import { createRoot } from 'react-dom/client'
import {
  CoreWorkspaceAgentFront,
  CreditBalanceBadge,
  DefaultTopBarRight,
} from '@hachej/boring-core/app/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { demoFrontPlugin } from '../plugins/demo/front'

// Lemon Squeezy hosted-checkout URL for a credit pack, injected at build time.
// Unset ⇒ the badge shows the balance without a buy button.
const checkoutUrl = import.meta.env.VITE_CREDITS_CHECKOUT_URL as string | undefined

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    chatEntryMode="chat-first"
    chatParams={{ thinkingControl: true }}
    plugins={[demoFrontPlugin]}
    topBarRight={
      <>
        <CreditBalanceBadge checkoutUrl={checkoutUrl} />
        <DefaultTopBarRight />
      </>
    }
  />,
)
