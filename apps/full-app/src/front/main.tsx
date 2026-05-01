import { createRoot } from 'react-dom/client'
import { CoreWorkspaceAgentFront } from '@boring/core/app/front'

import './app.css'

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    providerStorageKey="boring-ui-v2:layout:full-app"
    chatParams={{ thinkingControl: true }}
  />,
)
