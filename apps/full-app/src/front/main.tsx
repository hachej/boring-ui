import { createRoot } from 'react-dom/client'
import {
  CoreWorkspaceAgentFront,
  CreditBalanceBadge,
  DefaultTopBarRight,
} from '@hachej/boring-core/app/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { demoFrontPlugin } from '../plugins/demo/front'

// Show the Buy-credits button when the server has Lemon Squeezy checkout wired
// (set this alongside the server-side LS env). The checkout itself is created
// server-side so the buyer id can't be tampered with.
const buyEnabled = import.meta.env.VITE_CREDITS_BUY_ENABLED === '1'

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
        <CreditBalanceBadge buyEnabled={buyEnabled} />
        <DefaultTopBarRight />
      </>
    }
  />,
)
