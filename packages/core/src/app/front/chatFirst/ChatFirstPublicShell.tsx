import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { builtinCommands, type ChatSuggestion } from '@hachej/boring-agent/front'
import type {
  WorkspaceAgentFrontProps,
  WorkspaceAgentSession,
} from '@hachej/boring-workspace/app/front'
import { AuthCard } from './AuthCard.js'
import { AuthModal } from './AuthModal.js'
import { ChatFirstAuthenticatedShell } from './ChatFirstAuthenticatedShell.js'
import { safeReturnTo, writePendingChatEntry } from './pendingChatEntry.js'

export interface ChatFirstPublicShellOptions {
  composerPlaceholder?: string
  emptyState?: {
    eyebrow?: string
    title?: string
    description?: ReactNode
    footer?: ReactNode
  }
  suggestions?: ChatSuggestion[]
  /**
   * Predefined models for the composer's model picker. When provided, the
   * composer settings row (model + thinking pickers) is shown in the no-auth
   * hero, mirroring a regular chat session. The no-auth shell can't fetch the
   * model list from the server (server resources are disabled), so it must be
   * passed in here. `available` defaults to `true`.
   */
  models?: Array<{ provider: string; id: string; label: string; available?: boolean }>
  /**
   * Optional public top-bar contact CTA. When set, the no-auth top bar shows a
   * “Get in touch” button that opens a Calendly popover instead of asking users
   * to discover hidden chat commands.
   */
  contact?: {
    label?: string
    calendlyUrl: string
    title?: string
  }
  /**
   * Hand-drawn "Ask your AI here" / "Review its work here" annotations point at the
   * composer and the workspace surface to teach the empty public shell. Apps
   * that open a center panel on load (e.g. a landing page) should disable them,
   * otherwise the fixed-position arrows overlay the open panel. Defaults to on.
   */
  showTeachingArrows?: boolean
  /**
   * Marketing/navigation links rendered in the public (no-auth) top bar next to
   * the brand — e.g. About, Pricing, Docs. The authenticated workspace top bar
   * is unaffected. Use plain hrefs (router or full-page routes both work).
   */
  navLinks?: Array<{ label: string; href: string }>
}

const defaultPublicEmptyState = {
  eyebrow: 'Private AI workspace',
  title: 'Start in a secure workspace',
  description:
    'Draft a task, then continue in an isolated workspace where the assistant can inspect files, make changes, and run commands only inside that workspace.',
}

const defaultPublicSuggestions: ChatSuggestion[] = [
  { label: 'Audit a workspace', hint: 'Map files, risks, and next steps', prompt: 'Inspect this workspace, summarize what is here, and identify the safest next steps.' },
  { label: 'Make a safe change', hint: 'Edit files and verify the result', prompt: 'Make a small, safe change, run the relevant checks, and summarize the diff.' },
  { label: 'Explain access boundaries', hint: 'Files, commands, and model use', prompt: 'Explain what you can access in this workspace, what commands you may run, and how model processing works.' },
  { label: 'Plan a project', hint: 'Turn an idea into milestones', prompt: 'Turn my idea into a concrete workspace plan with milestones, risks, and verification steps.' },
]

function readComposerDraftFromDom(): string {
  if (typeof document === 'undefined') return ''
  const input = document.querySelector('[data-boring-agent-part="composer-input"]') as HTMLTextAreaElement | HTMLInputElement | null
  return input?.value ?? ''
}

function PublicTopBarActions({
  contact,
  onSignIn,
}: {
  contact?: ChatFirstPublicShellOptions['contact']
  onSignIn: () => void
}) {
  const [contactOpen, setContactOpen] = useState(false)
  return (
    <div className="public-topbar-actions">
      {contact ? (
        <div className="public-contact-popover-wrap">
          <button type="button" className="public-contact-button" onClick={() => setContactOpen((open) => !open)}>
            {contact.label ?? 'Get in touch'}
          </button>
          {contactOpen ? (
            <div className="public-contact-popover" role="dialog" aria-label={contact.title ?? 'Schedule a call'}>
              <div className="public-contact-popover-header">
                <span>{contact.title ?? 'Schedule a call'}</span>
                <button type="button" aria-label="Close contact popover" onClick={() => setContactOpen(false)}>×</button>
              </div>
              <iframe title={contact.title ?? 'Schedule a call'} src={contact.calendlyUrl} loading="lazy" />
            </div>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="public-sign-in-button" onClick={onSignIn}>Sign in</button>
    </div>
  )
}

export function ChatFirstPublicShell<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  appTitle,
  intendedWorkspaceId,
  publicShell,
  workspaceProps,
}: {
  appTitle: string
  intendedWorkspaceId?: string
  publicShell?: ChatFirstPublicShellOptions
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
}) {
  const location = useLocation()
  const [modalOpen, setModalOpen] = useState(false)
  const returnTo = safeReturnTo(location.pathname, location.search, location.hash)
  const promptedDraft = new URLSearchParams(location.search).get('prompt')?.trim() ?? ''
  const pendingReturnTo = promptedDraft ? '/' : returnTo
  const workspaceId = intendedWorkspaceId || 'public'
  const publicModels = (publicShell?.models ?? []).map((m) => ({ ...m, available: m.available ?? true }))
  const showComposerSettings = publicModels.length > 0
  const openAuth = (draft = readComposerDraftFromDom()) => {
    writePendingChatEntry({ draft, returnTo: pendingReturnTo, ...(intendedWorkspaceId ? { intendedWorkspaceId } : {}) })
    setModalOpen(true)
  }
  return (
    <div className="public-chat-first-shell relative h-screen min-h-0 bg-background">
      {publicShell?.showTeachingArrows !== false && (
        <>
          <div className="public-arrow public-arrow-computer" aria-hidden="true">
            <span className="public-arrow-label">Review its work here</span>
            <svg className="public-arrow-svg" viewBox="0 0 190 140" fill="none">
              <path
                className="paw-stroke"
                d="M14 122 C 58 134 104 128 134 100 C 150 85 160 64 164 40"
              />
              <path className="paw-stroke" d="M164 40 C 158 49 149 56 138 60" />
              <path className="paw-stroke" d="M164 40 C 168 51 170 63 169 75" />
            </svg>
          </div>
          <div className="public-arrow public-arrow-agent" aria-hidden="true">
            <svg className="public-arrow-svg" viewBox="0 0 120 116" fill="none">
              <path
                className="paw-stroke"
                d="M60 104 C 56 76 64 50 70 24 C 71 19 73 14 76 10"
              />
              <path className="paw-stroke" d="M76 10 C 70 16 62 19 53 20" />
              <path className="paw-stroke" d="M76 10 C 82 14 87 21 90 29" />
            </svg>
            <span className="public-arrow-label">Ask your AI here</span>
          </div>
        </>
      )}
      <aside className="pointer-events-none fixed bottom-6 left-6 z-20 w-[300px]">
        <div className="pointer-events-auto">
          <AuthCard returnTo={returnTo} />
        </div>
      </aside>
      <ChatFirstAuthenticatedShell
        appTitle={appTitle}
        workspaceId={workspaceId}
        showComposerBlocker={false}
        workspaceProps={{
            ...workspaceProps,
            // No-auth landing should open with the workspace surface closed —
            // a fresh load/hard refresh shows just the hero, not a re-opened
            // panel unless the app explicitly overrides defaultSurfaceOpen.
            defaultSurfaceOpen: workspaceProps.defaultSurfaceOpen ?? false,
            topBarRight: <PublicTopBarActions contact={publicShell?.contact} onSignIn={() => openAuth()} />,
            // No-auth shell has no real session yet — show just the brand, hide the
            // "· New session" placeholder that the default TopBar would render.
            topBarLeft: (
              <>
                <span
                  aria-hidden="true"
                  className="grid size-[22px] shrink-0 place-items-center rounded-sm bg-foreground text-[11px] font-semibold leading-none tracking-tight text-background"
                >
                  {(appTitle?.[0] ?? 'B').toUpperCase()}
                </span>
                <span className="truncate text-[13px] font-medium leading-none tracking-tight text-foreground">{appTitle}</span>
                {publicShell?.navLinks?.length ? (
                  <nav className="public-topbar-nav" aria-label="Site">
                    {publicShell.navLinks.map((link) => (
                      <a key={link.href} href={link.href}>{link.label}</a>
                    ))}
                  </nav>
                ) : null}
              </>
            ),
            className: workspaceProps.className,
            surfaceButtonBottomOffset: 456,
            chatParams: {
              ...workspaceProps.chatParams,
              emptyPlacement: 'hero',
              composerPlaceholder: publicShell?.composerPlaceholder ?? 'Sign in to continue in a private workspace',
              hideComposerSettings: !showComposerSettings,
              suppressPreSubmitCancelledWarning: true,
              thinkingControl: showComposerSettings,
              ...(showComposerSettings
                ? {
                    availableModels: publicModels,
                    hideDefaultModelOption: true,
                    defaultModel: { provider: publicModels[0].provider, id: publicModels[0].id },
                  }
                : {}),
              initialDraft: promptedDraft || undefined,
              emptyState: {
                ...defaultPublicEmptyState,
                ...publicShell?.emptyState,
              },
              suggestions: publicShell?.suggestions ?? defaultPublicSuggestions,
              commands: [],
              excludeBuiltinCommands: builtinCommands.map((command) => command.name),
              onBeforeSubmit: (draft: string) => {
                openAuth(draft)
                return false as const
              },
            },
        }}
      />
      {modalOpen ? <AuthModal returnTo={returnTo} onClose={() => setModalOpen(false)} /> : null}
    </div>
  )
}
