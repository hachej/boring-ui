import { createRoot } from 'react-dom/client'
import {
  BuyCreditsNoticeAction,
  CheckoutReturnBanner,
  CoreWorkspaceAgentFront,
  CREDITS_REFRESH_EVENT,
  CreditBalanceBadge,
  CreditsSettingsPanel,
  DefaultTopBarRight,
  isPaymentRequiredNotice,
  useCreditBalance,
} from '@hachej/boring-core/app/front'
import { UserSettingsPage } from '@hachej/boring-core/front'
import '@hachej/boring-core/app/front/styles.css'
import './app.css'
import { publicLaunchPlugin } from './PublicLaunchPages'

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
          { label: '/landing-page', hint: 'Get more details.', prompt: '/landing-page' },
          { label: '/reach-out', hint: 'Book a 30-minute live walkthrough.', prompt: '/reach-out' },
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
          <DefaultTopBarRight />
        </>
      }
    />
    {/* Post-checkout return (LS redirects to ?checkout=return); confirms server-side. */}
    <CheckoutReturnBanner />
  </>,
)
