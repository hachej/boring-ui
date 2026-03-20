import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Database, FolderOpen, GitBranch, Search, X } from 'lucide-react'
import FileTree from '../components/FileTree'
import GitChangesView from '../components/GitChangesView'
import { useGitHubConnection } from '../components/GitHubConnect'
import { useLightningFsGitBootstrap } from '../hooks/useLightningFsGitBootstrap'
import UserMenu from '../components/UserMenu'
import Tooltip from '../components/Tooltip'
import SidebarSectionHeader, {
  CollapsedSidebarActivityBar,
  LeftPaneHeader,
} from '../components/SidebarSectionHeader'
import { ICON_SIZE_INLINE } from '../utils/iconTokens'
import { useGitInit, useGitStatus } from '../providers/data'
import { routes } from '../utils/routes'
import SyncStatusFooter from '../components/SyncStatusFooter'

export default function FileTreePanel({ params }) {
  const {
    onOpenFile,
    onOpenFileToSide,
    onOpenDiff,
    projectRoot,
    activeFile,
    activeDiffFile,
    collapsed,
    onToggleCollapse,
    showSidebarToggle,
    appName,
    onOpenChatTab,
    sectionCollapsed,
    onToggleSection,
    onActivateSidebarPanel,
    activeSidebarPanelId,
    filetreeActivityIntent,
    userEmail,
    workspaceName,
    workspaceId,
    onSwitchWorkspace,
    showSwitchWorkspace,
    workspaceOptions,
    onCreateWorkspace,
    onOpenUserSettings,
    onOpenWorkspaceSettings,
    onLogout,
    userMenuStatusMessage,
    userMenuStatusTone,
    onUserMenuRetry,
    userMenuDisabledActions,
    githubEnabled,
    dataBackend,
  } = params
  const [creatingFile, setCreatingFile] = useState(false)
  const [viewMode, setViewMode] = useState('files') // 'files' | 'changes'
  const [searchExpanded, setSearchExpanded] = useState(false)
  const localGitInitAttemptsRef = useRef(new Set())
  const { data: gitStatus, isLoading: gitStatusLoading } = useGitStatus({
    refetchInterval: viewMode === 'changes' ? 5000 : false,
  })
  const gitInit = useGitInit()
  const { status: ghStatus, connect: ghConnect } = useGitHubConnection(workspaceId, { enabled: !!githubEnabled })
  const ghInstallationConnected = !!(ghStatus?.installation_connected ?? ghStatus?.connected)
  const ghRepoUrl = ghStatus?.repo_url ? String(ghStatus.repo_url).replace(/\.git$/, '') : null
  const isLightningFsBackend = dataBackend === 'lightningfs' || dataBackend === 'lightning-fs'
  const ghBootstrap = useLightningFsGitBootstrap({
    workspaceId,
    enabled: !!(githubEnabled && isLightningFsBackend),
    installationConnected: ghInstallationConnected,
    repoUrl: ghStatus?.repo_url || '',
  })
  const ghSyncReady = !!(
    githubEnabled
    && ghStatus?.repo_selected
    && ghRepoUrl
    && (!isLightningFsBackend || ghBootstrap.syncReady)
  )
  const handleGitHubAction = useCallback(() => {
    if (ghSyncReady) return
    if (ghInstallationConnected && workspaceId) {
      window.location.assign(routes.controlPlane.workspaces.scope(workspaceId, 'settings').path)
      return
    }
    ghConnect()
  }, [ghConnect, ghInstallationConnected, ghSyncReady, workspaceId])

  useEffect(() => {
    if (!isLightningFsBackend) return
    if (ghStatus?.repo_selected) return
    if (gitStatusLoading || gitInit.isPending) return
    if (gitStatus?.available === false || gitStatus?.is_repo !== false) return

    const attemptKey = String(workspaceId || '__default__')
    if (localGitInitAttemptsRef.current.has(attemptKey)) return
    localGitInitAttemptsRef.current.add(attemptKey)
    gitInit.mutate()
  }, [
    gitInit,
    gitStatus?.available,
    gitStatus?.is_repo,
    gitStatusLoading,
    ghStatus?.repo_selected,
    isLightningFsBackend,
    workspaceId,
  ])

  useEffect(() => {
    if (!filetreeActivityIntent || filetreeActivityIntent.panelId !== 'filetree') return
    if (filetreeActivityIntent.mode === 'changes') {
      setViewMode('changes')
      setSearchExpanded(false)
      return
    }
    if (filetreeActivityIntent.mode === 'search') {
      setViewMode('files')
      setSearchExpanded(true)
      return
    }
    setViewMode('files')
    setSearchExpanded(false)
  }, [filetreeActivityIntent])

  const handleFileCreated = (path) => {
    setCreatingFile(false)
    if (path) {
      onOpenFile(path)
    }
  }

  const handleCancelCreate = () => {
    setCreatingFile(false)
  }

  const openQuickFileSearch = useCallback(() => {
    if (viewMode !== 'files') {
      setViewMode('files')
    }
    if (collapsed && typeof onToggleCollapse === 'function') {
      onToggleCollapse()
    }
    if (sectionCollapsed && typeof onToggleSection === 'function') {
      onToggleSection()
    }
    setSearchExpanded(true)
  }, [viewMode, collapsed, onToggleCollapse, sectionCollapsed, onToggleSection])

  useEffect(() => {
    const handleQuickOpenShortcut = (event) => {
      const key = String(event.key || '').toLowerCase()
      if (key !== 'p' || event.shiftKey || event.altKey) return
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      openQuickFileSearch()
    }

    window.addEventListener('keydown', handleQuickOpenShortcut)
    return () => window.removeEventListener('keydown', handleQuickOpenShortcut)
  }, [openQuickFileSearch])

  const activateSidebarPanel = useCallback(
    (panelId, options = {}) => {
      if (typeof onActivateSidebarPanel === 'function') {
        onActivateSidebarPanel(panelId, options)
        return
      }
      if (collapsed && typeof onToggleCollapse === 'function') {
        onToggleCollapse()
      }
    },
    [collapsed, onActivateSidebarPanel, onToggleCollapse],
  )

  const activityItems = [
    {
      id: 'files',
      label: 'Files',
      icon: FolderOpen,
      active: activeSidebarPanelId === 'filetree' && viewMode === 'files' && !searchExpanded,
      onClick: () => {
        setViewMode('files')
        setSearchExpanded(false)
        activateSidebarPanel('filetree', { mode: 'files' })
      },
    },
    {
      id: 'data-catalog',
      label: 'Data Catalog',
      icon: Database,
      active: activeSidebarPanelId === 'data-catalog',
      onClick: () => activateSidebarPanel('data-catalog'),
    },
    {
      id: 'git',
      label: 'Git Changes',
      icon: GitBranch,
      active: activeSidebarPanelId === 'filetree' && viewMode === 'changes',
      onClick: () => {
        setViewMode('changes')
        setSearchExpanded(false)
        activateSidebarPanel('filetree', { mode: 'changes' })
      },
    },
    {
      id: 'search',
      label: 'Quick Search',
      icon: Search,
      active: activeSidebarPanelId === 'filetree' && viewMode === 'files' && searchExpanded,
      onClick: () => {
        setViewMode('files')
        setSearchExpanded(true)
        activateSidebarPanel('filetree', { mode: 'search' })
      },
    },
  ]

  if (collapsed) {
    return (
      <div className="panel-content filetree-panel filetree-collapsed">
        {showSidebarToggle && (
          <CollapsedSidebarActivityBar
            onExpandSidebar={onToggleCollapse}
            items={activityItems}
          />
        )}
        <div className="filetree-collapsed-footer">
          <UserMenu
            email={userEmail}
            workspaceName={workspaceName}
            workspaceId={workspaceId}
            statusMessage={userMenuStatusMessage}
            statusTone={userMenuStatusTone}
            onRetry={onUserMenuRetry}
            disabledActions={userMenuDisabledActions}
            showSwitchWorkspace={showSwitchWorkspace}
            onSwitchWorkspace={onSwitchWorkspace}
            workspaceOptions={workspaceOptions}
            onCreateWorkspace={onCreateWorkspace}
            onOpenUserSettings={onOpenUserSettings}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            onLogout={onLogout}
            collapsed
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`panel-content filetree-panel${sectionCollapsed ? ' filetree-section-collapsed' : ''}`}>
      {showSidebarToggle && (
        <LeftPaneHeader onToggleSidebar={onToggleCollapse} appName={appName} onOpenChatTab={onOpenChatTab} />
      )}
      {sectionCollapsed && <div className="filetree-section-spacer" />}
      <SidebarSectionHeader
        title="Files"
        icon={FolderOpen}
        sectionCollapsed={sectionCollapsed}
        onToggleSection={onToggleSection}
      >
        {!sectionCollapsed && (
          <>
            <Tooltip
              label={searchExpanded ? 'Close quick file search' : 'Quick file search'}
              shortcut={searchExpanded ? '' : 'Ctrl+P'}
            >
              <button
                type="button"
                className={`sidebar-action-btn${searchExpanded ? ' sidebar-action-btn--close' : ''}`}
                onClick={() => {
                  if (searchExpanded) {
                    setSearchExpanded(false)
                    return
                  }
                  openQuickFileSearch()
                }}
                aria-label={searchExpanded ? 'Close quick file search' : 'Quick file search'}
              >
                {searchExpanded ? <X size={20} /> : <Search size={ICON_SIZE_INLINE} />}
              </button>
            </Tooltip>
          </>
        )}
      </SidebarSectionHeader>
      {!sectionCollapsed && (
        <div className="filetree-body">
          {viewMode === 'files' ? (
            <FileTree
              onOpen={onOpenFile}
              onOpenToSide={onOpenFileToSide}
              projectRoot={projectRoot}
              activeFile={activeFile}
              creatingFile={creatingFile}
              onFileCreated={handleFileCreated}
              onCancelCreate={handleCancelCreate}
              searchExpanded={searchExpanded}
            />
          ) : (
            <GitChangesView
              onOpenDiff={onOpenDiff}
              activeDiffFile={activeDiffFile}
              workspaceId={workspaceId}
              githubEnabled={githubEnabled}
            />
          )}
        </div>
      )}
      {!sectionCollapsed && (
        <SyncStatusFooter
          githubEnabled={githubEnabled}
          githubConnected={ghSyncReady}
          githubHref={ghRepoUrl || ''}
          onGitHubClick={handleGitHubAction}
          githubBootstrapState={ghBootstrap.state}
          githubBootstrapMessage={ghBootstrap.message}
          githubBootstrapError={ghBootstrap.error}
          githubBootstrapBusy={ghBootstrap.busy}
          githubRemoteOpts={ghBootstrap.remoteOpts}
          githubRetryBootstrap={ghBootstrap.retry}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          onOpenChatTab={onOpenChatTab}
        />
      )}
      <div className="filetree-footer">
        <UserMenu
          email={userEmail}
          workspaceName={workspaceName}
          workspaceId={workspaceId}
          statusMessage={userMenuStatusMessage}
          statusTone={userMenuStatusTone}
          onRetry={onUserMenuRetry}
          disabledActions={userMenuDisabledActions}
          showSwitchWorkspace={showSwitchWorkspace}
          onSwitchWorkspace={onSwitchWorkspace}
          workspaceOptions={workspaceOptions}
          onCreateWorkspace={onCreateWorkspace}
          onOpenUserSettings={onOpenUserSettings}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onLogout={onLogout}
        />
      </div>
    </div>
  )
}
