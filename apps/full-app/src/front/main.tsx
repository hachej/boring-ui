import { createRoot } from 'react-dom/client'
import {
  CoreWorkspaceAgentFront,
  CreditBalanceBadge,
  CreditsSettingsPanel,
  DefaultTopBarRight,
} from '@hachej/boring-core/app/front'
import { UserSettingsPage } from '@hachej/boring-core/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { demoFrontPlugin } from '../plugins/demo/front'

// Show the Buy-credits button when the server has Lemon Squeezy checkout wired
// (set this alongside the server-side LS env). The checkout itself is created
// server-side so the buyer id can't be tampered with.
const buyEnabled = import.meta.env.VITE_CREDITS_BUY_ENABLED === '1'

// Surface the current balance + a "Buy credits" action on the account settings
// page (in addition to the top-bar badge). The panel self-hides when credits are
// disabled, so this is safe to wire unconditionally.
const AccountSettingsPage = () => <UserSettingsPage billing={<CreditsSettingsPanel />} />

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    chatEntryMode="chat-first"
    chatParams={{ thinkingControl: true }}
    plugins={[demoFrontPlugin]}
    authPages={{ userSettings: AccountSettingsPage }}
    topBarRight={
      <>
        <CreditBalanceBadge buyEnabled={buyEnabled} />
        <DefaultTopBarRight />
      </>
    }
  />,
)
