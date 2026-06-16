import { createRoot } from 'react-dom/client'
import { CoreWorkspaceAgentFront } from '@hachej/boring-core/app/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { publicLaunchPlugin } from './PublicLaunchPages'

const PRODUCT_NAME = 'Seneca AI'

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    appTitle={PRODUCT_NAME}
    chatEntryMode="chat-first"
    publicPaths={[]}
    chatFirstPublicShell={{
      showTeachingArrows: false,
      composerPlaceholder: 'Sign in to chat with the agent — or type a command like /landing-page',
      emptyState: {
        eyebrow: 'Seneca AI · Live demo',
        title: 'One workspace. Any AI provider.',
        description:
          'Seneca gives the AI of your choice a private remote computer to do real work for you: read files, run tasks, make changes, and show you what changed.',
        footer: (
          <div className="public-hero-foot">
            <span>Sign in to test the chat.</span>
            <a href="https://github.com/hachej/boring-ui" target="_blank" rel="noreferrer">
              Open source — see the project on GitHub →
            </a>
          </div>
        ),
      },
      suggestions: [
        {
          label: '/landing-page',
          hint: 'Get more details.',
          prompt: '/landing-page',
        },
        {
          label: '/reach-out',
          hint: 'Book a 30-minute live walkthrough.',
          prompt: '/reach-out',
        },
      ],
    }}
    chatParams={{
      thinkingControl: true,
      hideDefaultModelOption: true,
      emptyState: {
        eyebrow: 'Private workspace',
        title: 'What should the assistant work on?',
        description:
          'Ask the assistant to inspect files, edit safely, run checks, or explain the workspace. Commands and file access stay scoped to this workspace.',
      },
      suggestions: [
        {
          label: 'Inspect this workspace',
          hint: 'Summarize files and architecture.',
          prompt: 'Inspect this workspace and summarize the key files, architecture, and next steps.',
        },
        {
          label: 'Run a safety pass',
          hint: 'Find risks before changes.',
          prompt: 'Review this workspace for launch risks, security issues, and missing verification.',
        },
        {
          label: 'Make a verified change',
          hint: 'Edit, test, summarize.',
          prompt: 'Make the requested change, run the relevant checks, and summarize exactly what changed.',
        },
        {
          label: 'Explain data boundaries',
          hint: 'Files, commands, model provider.',
          prompt: 'Explain what data and files are available in this workspace and what provider processes model requests.',
        },
      ],
    }}
    surfaceInitialPanels={[
      { id: 'public-landing-page', component: 'public.launch.landing', title: 'Landing page' },
    ]}
    plugins={[publicLaunchPlugin]}
  />,
)
