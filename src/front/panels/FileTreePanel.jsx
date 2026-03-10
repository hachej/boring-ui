import React, { useCallback, useEffect, useState } from 'react'
import { Database, FolderOpen, GitBranch, Github, Loader2, Search, X } from 'lucide-react'
import FileTree from '../components/FileTree'
import GitChangesView from '../components/GitChangesView'
import { useGitHubConnection } from '../components/GitHubConnect'
import UserMenu from '../components/UserMenu'
import Tooltip from '../components/Tooltip'
import SidebarSectionHeader, {
  CollapsedSidebarActivityBar,
  LeftPaneHeader,
} from '../components/SidebarSectionHeader'
import { ICON_SIZE_INLINE } from '../utils/iconTokens'
import { useGitStatus } from '../providers/data'
import { apiFetchJson } from '../utils/transport'
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
  } = params
  const [creatingFile, setCreatingFile] = useState(false)
  const [viewMode, setViewMode] = useState('files') // 'files' | 'changes'
  const [searchExpanded, setSearchExpanded] = useState(false)
  const { isLoading: isGitLoading, isFetching: isGitFetching } = useGitStatus({
    refetchInterval: viewMode === 'changes' ? 5000 : false,
  })
  const showGitHeaderSpinner = viewMode === 'changes' && (isGitLoading || isGitFetching)
  const { status: ghStatus, connect: ghConnect } = useGitHubConnection(workspaceId, { enabled: !!githubEnabled })
  const showGitHubConnect = githubEnabled && ghStatus?.configured && !ghStatus?.connected
  const showGitHubLinked = githubEnabled && ghStatus?.connected

  const [ghRepoUrl, setGhRepoUrl] = useState(null)
  useEffect(() => {
    if (!ghStatus?.connected || !ghStatus?.installation_id) { setGhRepoUrl(null); return }
    apiFetchJson(`${routes.github.repos().path}?installation_id=${ghStatus.installation_id}`)
      .then(({ data }) => {
        const repo = data?.repos?.[0]
        if (repo?.clone_url) setGhRepoUrl(repo.clone_url.replace(/\.git$/, ''))
      })
      .catch(() => {})
  }, [ghStatus?.connected, ghStatus?.installation_id])

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
            <div className="sidebar-view-toggle sidebar-view-toggle--labeled" role="tablist" aria-label="Sidebar view mode">
              <button
                type="button"
                className={`view-toggle-btn view-toggle-btn--labeled ${viewMode === 'files' ? 'active' : ''}`}
                onClick={() => setViewMode('files')}
                aria-label="File tree view"
                role="tab"
                aria-selected={viewMode === 'files'}
              >
                <FolderOpen size={ICON_SIZE_INLINE} />
                <span>Files</span>
              </button>
              <button
                type="button"
                className={`view-toggle-btn view-toggle-btn--labeled ${viewMode === 'changes' ? 'active' : ''}`}
                onClick={() => setViewMode('changes')}
                aria-label="Git changes view"
                role="tab"
                aria-selected={viewMode === 'changes'}
              >
                <GitBranch size={ICON_SIZE_INLINE} />
                <span>Changes</span>
                {showGitHeaderSpinner && (
                  <Loader2 size={12} className="git-view-header-spinner" aria-hidden="true" />
                )}
              </button>
            </div>
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
            {showGitHubLinked && ghRepoUrl ? (
              <Tooltip label="Open GitHub repo">
                <a
                  className="sidebar-action-btn sidebar-action-btn--github sidebar-action-btn--github-linked"
                  href={ghRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open GitHub repo"
                >
                  <Github size={ICON_SIZE_INLINE} />
                </a>
              </Tooltip>
            ) : showGitHubConnect ? (
              <Tooltip label="Connect GitHub">
                <button
                  type="button"
                  className="sidebar-action-btn sidebar-action-btn--github"
                  onClick={ghConnect}
                  aria-label="Connect GitHub"
                >
                  <Github size={ICON_SIZE_INLINE} />
                </button>
              </Tooltip>
            ) : null}
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
      {!sectionCollapsed && <SyncStatusFooter githubConnected={ghStatus?.connected} />}
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
