import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import type {
  WorkspaceAgentFrontProps,
  WorkspaceAgentSession,
} from '@hachej/boring-workspace/app/front'
import { AuthModal } from './AuthModal.js'
import { ChatFirstAuthenticatedShell } from './ChatFirstAuthenticatedShell.js'
import { safeReturnTo, writePendingChatEntry } from './pendingChatEntry.js'

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
  workspaceProps,
}: {
  appTitle: string
  intendedWorkspaceId?: string
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
}) {
  const location = useLocation()
  const [modalOpen, setModalOpen] = useState(false)
  const returnTo = safeReturnTo(location.pathname, location.search, location.hash)
  const workspaceId = intendedWorkspaceId || 'public'
  const openAuth = (draft = readComposerDraftFromDom()) => {
    writePendingChatEntry({ draft, returnTo, ...(intendedWorkspaceId ? { intendedWorkspaceId } : {}) })
    setModalOpen(true)
  }
  return (
    <div className="relative h-screen min-h-0">
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
            composerPlaceholder: 'Describe the app, bug, or repo task you want help with…',
            emptyState: {
              eyebrow: 'Start here',
              title: 'What do you want to build?',
              description: 'Type a prompt or pick an example. Sign in on send to unlock your private workspace.',
            },
            suggestions: [
              { label: 'Build an app from scratch', hint: 'Creates files, installs deps, opens a preview', prompt: 'Build a full-stack app with auth, a dashboard, and sample data.' },
              { label: 'Understand a codebase', hint: 'Maps the repo and explains where to start', prompt: 'Explain this codebase, map the architecture, and suggest first improvements.' },
              { label: 'Fix a bug safely', hint: 'Finds the cause, edits files, runs tests', prompt: 'Trace a bug, edit the right files, update tests, and summarize the diff.' },
              { label: 'Prototype an interface', hint: 'Turns an idea into an interactive UI', prompt: 'Build an interactive prototype and open it in the workspace.' },
            ],
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
