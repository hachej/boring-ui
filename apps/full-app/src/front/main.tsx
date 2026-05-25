import { createRoot } from 'react-dom/client'
import { CoreWorkspaceAgentFront } from '@hachej/boring-core/app/front'
import { askUserPlugin } from '@hachej/boring-ask-user/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    plugins={[askUserPlugin]}
    chatParams={{ thinkingControl: true }}
  />,
)
