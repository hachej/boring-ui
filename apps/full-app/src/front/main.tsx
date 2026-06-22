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
import { UserMenu, UserSettingsPage } from '@hachej/boring-core/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { PublicHeroDescription, publicLaunchPlugin } from './PublicLaunchPages'

const PRODUCT_NAME = 'Seneca AI'

// Show the Buy-credits button when the server has Lemon Squeezy checkout wired
// (set this alongside the server-side LS env). The checkout itself is created
// server-side so the buyer id can't be tampered with.
const buyEnabled = import.meta.env.VITE_CREDITS_BUY_ENABLED === '1'

// Surface the current balance + a "Buy credits" action on the account settings page
// (in addition to the top-bar badge). Gate the Billing section on the same hook the
// panel uses, so the nav entry and the panel appear/disappear together — `hidden` is
// true when credits are disabled or the user is unauthenticated, where the panel would
// self-hide and otherwise leave a dangling nav link with no target.
const AccountSettingsPage = () => {
  const { hidden } = useCreditBalance()
  return (
    <UserSettingsPage
      extraSections={
        hidden
          ? []
          : [
              {
                id: 'billing',
                navLabel: 'Billing',
                navDescription: 'Credits and top-up',
                content: <CreditsSettingsPanel />,
              },
            ]
      }
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
      appTitle={PRODUCT_NAME}
      workspaceLayout="plugin-tabs"
      workspaceSectionTitle="Projects"
      showSkills={false}
      showPlugins={false}
      chatEntryMode="chat-first"
      publicPaths={[]}
      chatFirstPublicShell={{
        showTeachingArrows: true,
        composerPlaceholder: 'Sign in to chat with the agent — or type a command like /landing-page',
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
        suggestions: [
          { label: '/landing-page', hint: 'Get more details.', prompt: '/landing-page' },
          { label: '/reach-out', hint: 'Book a 30-minute live walkthrough.', prompt: '/reach-out' },
        ],
        models: [
          // European-hosted · Frontier · Local — one per category.
          { provider: 'infomaniak', id: 'minimax-2.5', label: 'MiniMax 2.5 · Infomaniak' },
          { provider: 'openai', id: 'gpt-5.5-codex', label: 'GPT-5.5 Codex' },
          { provider: 'local', id: 'qwen3.6', label: 'Qwen 3.6 · Local' },
        ],
      }}
      chatParams={chatParams}
      chatFirstPublicWorkspaceProps={{
        surfaceInitialPanels: [
          { id: 'public-landing-page', component: 'public.launch.landing', title: 'Landing page' },
        ],
        plugins: [publicLaunchPlugin],
      }}
      authPages={{ userSettings: AccountSettingsPage }}
      topBarRight={
        <>
          <CreditBalanceBadge buyEnabled={buyEnabled} />
          <UserMenu contentSide="top" contentAlign="start" />
        </>
      }
    />
    {/* Post-checkout return (LS redirects to ?checkout=return); confirms server-side. */}
    <CheckoutReturnBanner />
  </>,
)
