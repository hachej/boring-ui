import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { builtinCommands, type ChatSuggestion, type SlashCommand } from '@hachej/boring-agent/front'
import { postUiCommand } from '@hachej/boring-workspace'
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
    description?: string
    footer?: ReactNode
  }
  suggestions?: ChatSuggestion[]
  /**
   * Hand-drawn "Your agent" / "Your remote computer" annotations point at the
   * composer and the workspace surface to teach the empty public shell. Apps
   * that open a center panel on load (e.g. a landing page) should disable them,
   * otherwise the fixed-position arrows overlay the open panel. Defaults to on.
   */
  showTeachingArrows?: boolean
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
  const lastAutoRunCommandRef = useRef('')
  const returnTo = safeReturnTo(location.pathname, location.search, location.hash)
  const promptedDraft = new URLSearchParams(location.search).get('prompt')?.trim() ?? ''
  const pendingReturnTo = promptedDraft ? '/' : returnTo
  const workspaceId = intendedWorkspaceId || 'public'
  const openAuth = (draft = readComposerDraftFromDom()) => {
    writePendingChatEntry({ draft, returnTo: pendingReturnTo, ...(intendedWorkspaceId ? { intendedWorkspaceId } : {}) })
    setModalOpen(true)
  }
  const normalizePublicCommand = (draft: string) => draft.trim().toLowerCase().replace(/[’`]/g, "'")
  const openLandingPage = () => postUiCommand({
    kind: 'openPanel',
    params: { id: 'public-landing-page', component: 'public.launch.landing', title: 'Landing page' },
  })
  const openLetsChat = () => postUiCommand({
    kind: 'openPanel',
    params: { id: 'public-lets-chat', component: 'public.launch.lets-chat', title: 'Let’s chat' },
  })
  const publicCommands: SlashCommand[] = [
    {
      name: 'landing-page',
      description: 'Open the landing page workspace tab.',
      kind: 'local',
      handler: () => {
        openLandingPage()
        return { message: 'Opened Landing page.' }
      },
    },
    {
      name: 'reach-out',
      description: 'Open the Calendly workspace tab.',
      kind: 'local',
      handler: () => {
        openLetsChat()
        return { message: 'Opened Let’s chat.' }
      },
    },
  ]
  const runPublicCommand = (draft: string): boolean => {
    const command = normalizePublicCommand(draft)
    if (command === '/landing-page') {
      openLandingPage()
      return true
    }
    if (command === '/reach-out' || command === "/let's-chat" || command === '/lets-chat') {
      openLetsChat()
      return true
    }
    return false
  }

  useEffect(() => {
    const intercept = (event: Event): boolean => {
      const draft = readComposerDraftFromDom()
      if (!runPublicCommand(draft)) return false
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-boring-agent-part="composer-submit"], [aria-label="Submit"]')) return
      intercept(event)
    }
    const maybeAutoRunDraft = () => {
      const draft = readComposerDraftFromDom()
      const command = normalizePublicCommand(draft)
      const isCommand = command === '/landing-page' || command === '/reach-out' || command === "/let's-chat" || command === '/lets-chat'
      if (!isCommand) {
        lastAutoRunCommandRef.current = ''
        return
      }
      if (lastAutoRunCommandRef.current === command) return
      lastAutoRunCommandRef.current = command
      runPublicCommand(draft)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-boring-agent-part="composer-input"]')) return
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) intercept(event)
    }
    const onInput = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-boring-agent-part="composer-input"]')) return
      window.setTimeout(maybeAutoRunDraft, 0)
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('input', onInput, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('input', onInput, true)
    }
  })

  return (
    <div className="public-chat-first-shell relative h-screen min-h-0 bg-background">
      {publicShell?.showTeachingArrows !== false && (
        <>
          <div className="public-arrow public-arrow-computer" aria-hidden="true">
            <span className="public-arrow-label">Your remote computer</span>
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
            <span className="public-arrow-label">Your agent</span>
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
            topBarRight: <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted" onClick={() => openAuth()}>Sign in</button>,
            className: workspaceProps.className,
            surfaceButtonBottomOffset: 456,
            chatParams: {
              ...workspaceProps.chatParams,
              emptyPlacement: 'hero',
              composerPlaceholder: publicShell?.composerPlaceholder ?? 'Type /landing-page or /reach-out',
              hideComposerSettings: true,
              suppressPreSubmitCancelledWarning: true,
              thinkingControl: false,
              initialDraft: promptedDraft || undefined,
              emptyState: {
                ...defaultPublicEmptyState,
                ...publicShell?.emptyState,
              },
              suggestions: publicShell?.suggestions ?? defaultPublicSuggestions,
              commands: publicCommands,
              excludeBuiltinCommands: builtinCommands.map((command) => command.name),
              onBeforeSubmit: (draft: string) => {
                if (!runPublicCommand(draft)) openAuth(draft)
                return false as const
              },
            },
        }}
      />
      {modalOpen ? <AuthModal returnTo={returnTo} onClose={() => setModalOpen(false)} /> : null}
    </div>
  )
}
