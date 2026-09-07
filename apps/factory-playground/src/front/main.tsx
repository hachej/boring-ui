import { createRoot } from 'react-dom/client'
import { createAskUserPlugin } from '@hachej/boring-ask-user/front'
import boringAutomationPlugin from '@hachej/boring-automation/front'
import { createTasksPlugin } from '@hachej/boring-tasks/front'
import { WorkspaceAgentFront } from '@hachej/boring-workspace/app/front'
import '@hachej/boring-agent/front/styles.css'
import '@hachej/boring-workspace/globals.css'
import './app.css'
import { FactoryEpicsOverlay, factoryEpicsIcon } from './FactoryEpicsOverlay'

const plugins = [
  createAskUserPlugin({ appLeftInbox: true }),
  createTasksPlugin(),
  boringAutomationPlugin,
]

createRoot(document.getElementById('root')!).render(
  <WorkspaceAgentFront
    workspaceId="factory-hub"
    agentTypeId="boring-orchestrator"
    addressedAgentSelection
    apiBaseUrl=""
    persistenceEnabled
    plugins={plugins}
    appTitle="Boring Factory"
    workspaceLabel="Native factory playground"
    workspaceLayout="plugin-tabs"
    appLeftOverlayActions={[{
      id: 'factory-epics',
      label: 'Epics',
      icon: factoryEpicsIcon,
      render: ({ onClose }) => <FactoryEpicsOverlay onClose={onClose} />,
    }]}
    defaultSessionTitle="Factory run"
    provisionWorkspace
    chatParams={{
      thinkingControl: true,
      emptyState: {
        eyebrow: 'Native Boring Factory',
        title: 'What feature should the factory build?',
        description: 'Start with the Orchestrator, approve the plan in Inbox, then watch Worker sessions, Tasks, Automations, and sandbox-backed proof.',
      },
      suggestions: [{
        label: 'Build the demo feature',
        hint: 'Plan and supervise the seeded greeting change.',
        prompt: 'Create a small feature that adds an excited greeting to the demo repository. Plan it, raise the owner gate, then use the factory loop without implementing it yourself.',
      }],
    }}
  />,
)
