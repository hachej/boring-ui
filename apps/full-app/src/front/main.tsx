import { createRoot } from 'react-dom/client'
import { CoreWorkspaceAgentFront } from '@hachej/boring-core/app/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { demoFrontPlugin } from '../plugins/demo/front'

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    chatEntryMode="chat-first"
    chatParams={{ thinkingControl: true }}
    plugins={[demoFrontPlugin]}
  />,
)
