import React, { useCallback, useEffect, useState } from 'react'
import { Database, FolderOpen, GitBranch, Loader2, Search, X } from 'lucide-react'
import FileTree from '../components/FileTree'
import GitChangesView from '../components/GitChangesView'
import UserMenu from '../components/UserMenu'
import Tooltip from '../components/Tooltip'
import SidebarSectionHeader, {
  CollapsedSidebarActivityBar,
  LeftPaneHeader,
} from '../components/SidebarSectionHeader'
import { ICON_SIZE_INLINE } from '../utils/iconTokens'
import { useGitStatus } from '../providers/data'

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
    onCreateWorkspace,
    onOpenUserSettings,
    onLogout,
    userMenuStatusMessage,
    userMenuStatusTone,
    onUserMenuRetry,
    userMenuDisabledActions,
  } = params
  const [creatingFile, setCreatingFile] = useState(false)
  const [viewMode, setViewMode] = useState('files') // 'files' | 'changes'
  const [searchExpanded, setSearchExpanded] = useState(false)
  const { isLoading: isGitLoading, isFetching: isGitFetching } = useGitStatus({
    refetchInterval: 5000,
    enabled: viewMode === 'changes',
  })
  const showGitHeaderSpinner = viewMode === 'changes' && (isGitLoading || isGitFetching)

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
            onCreateWorkspace={onCreateWorkspace}
            onOpenUserSettings={onOpenUserSettings}
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
        <LeftPaneHeader onToggleSidebar={onToggleCollapse} appName={appName} />
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
            <div className="sidebar-view-toggle" role="tablist" aria-label="Sidebar view mode">
              <Tooltip label="File tree">
                <button
                  type="button"
                  className={`view-toggle-btn ${viewMode === 'files' ? 'active' : ''}`}
                  onClick={() => setViewMode('files')}
                  aria-label="File tree view"
                  role="tab"
                  aria-selected={viewMode === 'files'}
                >
                  <FolderOpen size={ICON_SIZE_INLINE} />
                </button>
              </Tooltip>
              <Tooltip label="Git changes">
                <button
                  type="button"
                  className={`view-toggle-btn ${viewMode === 'changes' ? 'active' : ''}`}
                  onClick={() => setViewMode('changes')}
                  aria-label="Git changes view"
                  role="tab"
                  aria-selected={viewMode === 'changes'}
                >
                  <GitBranch size={ICON_SIZE_INLINE} />
                  {showGitHeaderSpinner && (
                    <Loader2 size={12} className="git-view-header-spinner" aria-hidden="true" />
                  )}
                </button>
              </Tooltip>
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
            />
          )}
        </div>
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
          onCreateWorkspace={onCreateWorkspace}
          onOpenUserSettings={onOpenUserSettings}
          onLogout={onLogout}
        />
      </div>
    </div>
  )
}
