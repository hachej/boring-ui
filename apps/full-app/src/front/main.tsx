import { createRoot } from 'react-dom/client'
import {
  BuyCreditsNoticeAction,
  CheckoutReturnBanner,
  CoreWorkspaceAgentFront,
  CREDITS_REFRESH_EVENT,
  CreditBalanceBadge,
  CreditsSettingsPanel,
  isPaymentRequiredNotice,
  useCreditBalance,
} from '@hachej/boring-core/app/front'
import {
  UserMenu,
  UserSettingsPage,
  WorkspaceSwitcher,
} from '@hachej/boring-core/front'
import '@hachej/boring-core/app/front/styles.css'
import { GovernanceUsagePanel, createGovernanceCompanyAdmin } from '@hachej/boring-governance/front'
import { BoringMcpSourcesOverlay } from '@hachej/boring-mcp/front'
import { PublicHeroDescription } from './PublicHeroDescription'
import { fullAppBoringMcpOptions } from './boringMcp'

const PRODUCT_NAME = 'Seneca AI'

// Show the Buy-credits button when the server has Lemon Squeezy checkout wired
// (set this alongside the server-side LS env). The checkout itself is created
// server-side so the buyer id can't be tampered with.
const buyEnabled = import.meta.env.VITE_CREDITS_BUY_ENABLED === '1'

// Inline multi-project left bar (projects tree) is still being consolidated
// (persistent shell / background workspace load — follow-up PR). Ship it OFF by
// default: the left bar shows the workspace-switcher dropdown at the top
// (single-project). Set VITE_BORING_INLINE_PROJECTS=1 to opt in for dev.
const inlineProjectsEnabled = import.meta.env.VITE_BORING_INLINE_PROJECTS === '1'

// Keep production deployments focused by default: hide advanced workspace tooling
// unless explicitly enabled. Dev keeps it visible for local dogfooding.
const workspaceToolingEnabled = import.meta.env.DEV || import.meta.env.VITE_BORING_WORKSPACE_TOOLING === '1'
const boringMcpUiEnabled = import.meta.env.PROD
  ? import.meta.env.VITE_BORING_MCP_PROD_ENABLED === '1'
  : import.meta.env.VITE_BORING_MCP_ENABLED !== '0'

function McpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c4.42 0 8 1.34 8 3s-3.58 3-8 3-8-1.34-8-3 3.58-3 8-3Z" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  )
}

// Surface the current balance + a "Buy credits" action on the account settings page
// (in addition to the top-bar badge). Gate the Billing section on the same hook the
// panel uses, so the nav entry and the panel appear/disappear together — `hidden` is
// true when credits are disabled or the user is unauthenticated, where the panel would
// self-hide and otherwise leave a dangling nav link with no target.
const AccountSettingsPage = () => {
  const { hidden } = useCreditBalance()
  return (
    <UserSettingsPage
      extraSections={[
        // Full governed-usage panel (role + aggregate cap + company-context
        // access + per-model usage meters + context paths). Self-fetches from the
        // governance usage-summary route and renders nothing when governance is
        // disabled, so this section is inert on non-governed deployments.
        {
          id: 'usage',
          navLabel: 'Usage limits',
          navDescription: 'Role, caps, and consumption',
          content: <GovernanceUsagePanel className="max-w-xl" />,
        },
        ...(hidden
          ? []
          : [
              {
                id: 'billing',
                navLabel: 'Billing',
                navDescription: 'Credits and top-up',
                content: <CreditsSettingsPanel />,
              },
            ]),
      ]}
    />
  )
}

// Credit-aware chat wiring — the ONLY place credits meet the agent. The agent
// exposes generic seams (a stable error code + lifecycle callbacks); here we map
// them to credit UX without the agent knowing about billing:
//  - onTurnComplete → broadcast a balance refresh so the badge updates right after
//    a run settles (credits are debited async, so the hook's retry burst polls).
//  - renderNoticeAction → attach a Buy-credits button to a PAYMENT_REQUIRED
//    run-rejected notice. Wired unconditionally: BuyCreditsNoticeAction self-hides on
//    the SERVER's checkoutEnabled, so it can't be suppressed by a missing/stale Vite
//    flag while checkout actually works (the flag only feeds the badge fallback).
const governanceCompanyAdmin = createGovernanceCompanyAdmin()

const chatParams = {
  thinkingControl: true,
  hideDefaultModelOption: true,
  emptyState: {
    eyebrow: 'Private workspace',
    title: 'What should we build?',
    description:
      'Ask the assistant to fetch data, run an analysis, and turn it into something you can use — a chart, a deck, a report. It works in your private workspace and opens results as tabs you can inspect.',
  },
  suggestions: [
    { label: 'Fetch & explore data', hint: 'Pull a dataset, surface the trends.', prompt: 'Fetch a relevant dataset, then summarize the key series, trends, and anything that stands out.' },
    { label: 'Create a deck', hint: 'Turn findings into slides.', prompt: 'Analyze the data and build a clean, presentation-ready slide deck of the key findings.' },
    { label: 'Build a chart', hint: 'Visualize the key numbers.', prompt: 'Create a clear chart that visualizes the most important series, and explain what it shows.' },
    { label: 'Analyze & report', hint: 'Insights, written up.', prompt: 'Run an analysis on the data and write up the key insights as a short, sourced report.' },
  ],
  // Credit seams: refresh the balance after each run, and offer a Buy CTA on an
  // out-of-credits (PAYMENT_REQUIRED) notice.
  onTurnComplete: () => window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT)),
  renderNoticeAction: (notice: { errorCode?: string }) =>
    isPaymentRequiredNotice(notice) ? <BuyCreditsNoticeAction /> : null,
}

createRoot(document.getElementById('root')!).render(
  <>
    <CoreWorkspaceAgentFront
      apiBaseUrl=""
      apiTimeout={10_000}
      persistenceEnabled
      companyAdmin={governanceCompanyAdmin}
      appTitle={PRODUCT_NAME}
      workspaceLayout="plugin-tabs"
      appLeftHeaderMode="workspace"
      topBarLeft={<WorkspaceSwitcher displayMode="workspace" />}
      appLeftLayoutMode={inlineProjectsEnabled ? 'multi-project' : 'single-project'}
      workspaceSectionTitle="Projects"
      showSkills={workspaceToolingEnabled}
      showPlugins={workspaceToolingEnabled}
      appLeftOverlayActions={boringMcpUiEnabled ? [
        {
          id: 'boring-mcp',
          label: 'MCP',
          icon: <McpIcon className="h-4 w-4" />,
          render: ({ onClose, headerInsetStart, headerInsetEnd, workspaceId }) => (
            <BoringMcpSourcesOverlay
              options={{
                ...fullAppBoringMcpOptions,
                sourceApi: fullAppBoringMcpOptions.sourceApi
                  ? { ...fullAppBoringMcpOptions.sourceApi, workspaceId }
                  : undefined,
              }}
              onClose={onClose}
              headerInsetStart={headerInsetStart}
              headerInsetEnd={headerInsetEnd}
            />
          ),
        },
      ] : []}
      chatEntryMode="chat-first"
      publicPaths={[]}
      chatFirstPublicShell={{
        showTeachingArrows: false,
        composerPlaceholder: 'Sign in to chat with the agent',
        emptyState: {
          eyebrow: PRODUCT_NAME,
          title: 'One workspace. Any AI provider',
          description: <PublicHeroDescription />,
          footer: (
            <div className="public-hero-foot">
              <span className="public-hero-providers">Supports local models, European-hosted providers, and frontier AI labs</span>
              <span className="public-hero-dot" aria-hidden="true">·</span>
              <a className="public-hero-github" href="https://github.com/hachej/boring-ui" target="_blank" rel="noreferrer">
                Open source
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
                </svg>
              </a>
            </div>
          ),
        },
        suggestions: [],
        models: [
          // European-hosted · Frontier · Local — one per category.
          { provider: 'infomaniak', id: 'minimax-2.5', label: 'MiniMax 2.5 · Infomaniak' },
          { provider: 'openai', id: 'gpt-5.5-codex', label: 'GPT-5.5 Codex' },
          { provider: 'local', id: 'qwen3.6', label: 'Qwen 3.6 · Local' },
        ],
      }}
      chatParams={chatParams}
      chatFirstPublicWorkspaceProps={{
        surfaceInitialPanels: [],
        plugins: [],
      }}
      authPages={{ userSettings: AccountSettingsPage }}
      topBarRight={
        <div className="flex w-full min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-0.5 text-[11px] text-muted-foreground/70">
            <span>Credits</span>
            <CreditBalanceBadge buyEnabled={buyEnabled} />
          </div>
          <UserMenu variant="bar" contentSide="top" contentAlign="start" />
        </div>
      }
    />
    {/* Post-checkout return (LS redirects to ?checkout=return); confirms server-side. */}
    <CheckoutReturnBanner />
  </>,
)
