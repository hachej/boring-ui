import { createRoot } from 'react-dom/client'
import { CoreWorkspaceAgentFront } from '@hachej/boring-core/app/front'
import { askUserPlugin } from '@hachej/boring-ask-user/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { demoFrontPlugin } from '../plugins/demo/front'

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    plugins={[askUserPlugin, demoFrontPlugin]}
    chatEntryMode="chat-first"
    chatParams={{ thinkingControl: true }}
  />,
)
