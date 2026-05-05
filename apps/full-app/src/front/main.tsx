import { createRoot } from 'react-dom/client'
import { CoreWorkspaceAgentFront } from '@boring/core/app/front'
import '@boring/core/app/front/styles.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    chatParams={{ thinkingControl: true }}
  />,
)
