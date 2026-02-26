import React, { useState } from 'react'
import { ChevronRight, FolderOpen, GitBranch, Plus } from 'lucide-react'
import FileTree from '../components/FileTree'
import GitChangesView from '../components/GitChangesView'
import UserMenu from '../components/UserMenu'
import SidebarSectionHeader, { LeftPaneHeader } from '../components/SidebarSectionHeader'

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
    sectionCollapsed,
    onToggleSection,
    userEmail,
    workspaceName,
    workspaceId,
    onSwitchWorkspace,
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

  const handleNewFile = () => {
    setCreatingFile(true)
  }

  const handleFileCreated = (path) => {
    setCreatingFile(false)
    if (path) {
      onOpenFile(path)
    }
  }

  const handleCancelCreate = () => {
    setCreatingFile(false)
  }

  if (collapsed) {
    return (
      <div className="panel-content filetree-panel filetree-collapsed">
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <ChevronRight size={12} />
        </button>
        <div className="sidebar-collapsed-label">{viewMode === 'files' ? 'Files' : 'Changes'}</div>
        <div className="filetree-collapsed-footer">
          <UserMenu
            email={userEmail}
            workspaceName={workspaceName}
            workspaceId={workspaceId}
            statusMessage={userMenuStatusMessage}
            statusTone={userMenuStatusTone}
            onRetry={onUserMenuRetry}
            disabledActions={userMenuDisabledActions}
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
    <div className="panel-content filetree-panel">
      {showSidebarToggle && <LeftPaneHeader onToggleSidebar={onToggleCollapse} />}
      <SidebarSectionHeader
        title="Files"
        sectionCollapsed={sectionCollapsed}
        onToggleSection={onToggleSection}
      />
      {!sectionCollapsed && (
        <>
          <div className="filetree-toolbar">
            <div className="sidebar-view-toggle">
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'files' ? 'active' : ''}`}
                onClick={() => setViewMode('files')}
                title="File tree"
              >
                <FolderOpen size={14} />
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'changes' ? 'active' : ''}`}
                onClick={() => setViewMode('changes')}
                title="Git changes"
              >
                <GitBranch size={14} />
              </button>
            </div>
            <div className="filetree-toolbar-spacer" />
            {viewMode === 'files' && (
              <button
                type="button"
                className="sidebar-action-btn"
                onClick={handleNewFile}
                title="New File"
                aria-label="New File"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
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
              />
            ) : (
              <GitChangesView
                onOpenDiff={onOpenDiff}
                activeDiffFile={activeDiffFile}
              />
            )}
          </div>
        </>
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
          onSwitchWorkspace={onSwitchWorkspace}
          onCreateWorkspace={onCreateWorkspace}
          onOpenUserSettings={onOpenUserSettings}
          onLogout={onLogout}
        />
      </div>
    </div>
  )
}
