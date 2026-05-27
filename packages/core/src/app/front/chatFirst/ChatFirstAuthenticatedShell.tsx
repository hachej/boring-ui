import { useEffect } from 'react'
import {
  WorkspaceAgentFront,
  type WorkspaceAgentFrontProps,
  type WorkspaceAgentSession,
} from '@hachej/boring-workspace/app/front'
import { useWorkspaceAttention } from '@hachej/boring-workspace'

export interface ChatFirstAuthenticatedShellProps<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
> {
  appTitle: string
  workspaceId: string
  initialDraft?: string
  autoSubmitInitialDraft?: boolean
  workspaceProps: Omit<WorkspaceAgentFrontProps<TSession>, 'workspaceId' | 'frontPluginHotReload' | 'hotReloadEnabled'>
  showComposerBlocker?: boolean
}

function ChatFirstComposerBlocker() {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()

  useEffect(() => {
    const blocker = {
      id: 'chat-first-workspace-preparing',
      reason: 'workspace-preparing',
      label: 'Preparing workspace… Send will work in a moment.',
    }
    addBlocker(blocker)
    return () => removeBlocker(blocker.id)
  }, [addBlocker, removeBlocker])

  return null
}

export function ChatFirstAuthenticatedShell<
  TSession extends WorkspaceAgentSession = WorkspaceAgentSession,
>({
  appTitle,
  workspaceId,
  initialDraft,
  autoSubmitInitialDraft = false,
  workspaceProps,
  showComposerBlocker = true,
}: ChatFirstAuthenticatedShellProps<TSession>) {
  return (
    <WorkspaceAgentFront
      {...workspaceProps}
      workspaceId={workspaceId}
      appTitle={appTitle}
      topBarLeft={null}
      sessions={[]}
      activeSessionId={null}
      onSwitchSession={() => undefined}
      onCreateSession={() => undefined}
      onDeleteSession={() => undefined}
      provisionWorkspace={false}
      bootPreloadPaths={[]}
      bridgeEndpoint={null}
      excludeDefaults={['filesystem']}
      plugins={[]}
      catalogs={[]}
      commands={[]}
      persistenceEnabled={false}
      navEnabled={false}
      defaultNavOpen={false}
      defaultSurfaceOpen={false}
      beforeShell={showComposerBlocker ? <>{workspaceProps.beforeShell}<ChatFirstComposerBlocker /></> : workspaceProps.beforeShell}
      chatParams={{
        ...workspaceProps.chatParams,
        composerBlockers: undefined,
        ...(initialDraft ? { initialDraft } : {}),
        ...(initialDraft && autoSubmitInitialDraft ? { autoSubmitInitialDraft: true } : {}),
        serverResourcesEnabled: false,
        hydrateMessages: false,
        onBeforeSubmit: showComposerBlocker
          ? (() => false as const)
          : workspaceProps.chatParams?.onBeforeSubmit ?? (() => false as const),
      }}
      frontPluginHotReload={false}
      hotReloadEnabled={false}
    />
  )
}
