import React, { useMemo } from 'react'
import { Command, FileText, Github, GitBranch, Loader2 } from 'lucide-react'
import { useGitStatus } from '../providers/data'
import { useGitHubConnection } from './GitHubConnect'

const STATUS_CONFIG = {
  M: { label: 'Modified', className: 'git-status-modified', icon: 'M' },
  U: { label: 'Untracked', className: 'git-status-new', icon: 'U' },
  A: { label: 'Added', className: 'git-status-added', icon: 'A' },
  D: { label: 'Deleted', className: 'git-status-deleted', icon: 'D' },
  C: { label: 'Conflict', className: 'git-status-conflict', icon: 'C' },
}

function ConnectGitHubButton({ workspaceId }) {
  const { status, loading, connect } = useGitHubConnection(workspaceId)
  if (loading || status?.connected || !status?.configured) return null
  return (
    <button
      type="button"
      className="github-connect-compact"
      onClick={connect}
      title="Connect GitHub for push/pull"
    >
      <Github size={14} />
      <span>Connect GitHub</span>
    </button>
  )
}

export default function GitChangesView({ onOpenDiff, activeDiffFile, workspaceId, githubEnabled }) {
  const { data: gitStatus, isLoading, error, refetch } = useGitStatus({ refetchInterval: 5000 })

  const changes = useMemo(() => {
    const files = gitStatus?.files
    if (Array.isArray(files)) {
      return files.reduce((acc, entry) => {
        if (entry?.path && entry?.status) {
          acc[entry.path] = entry.status
        }
        return acc
      }, {})
    }
    if (files && typeof files === 'object') {
      return files
    }
    return {}
  }, [gitStatus])

  const handleFileClick = (path, status) => {
    if (onOpenDiff) {
      onOpenDiff(path, status)
    }
  }

  const getFileName = (path) => {
    const parts = path.split('/')
    return parts[parts.length - 1]
  }

  const getDirectory = (path) => {
    const parts = path.split('/')
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/')
  }

  // Group files by status
  const groupedChanges = Object.entries(changes).reduce((acc, [path, status]) => {
    if (!acc[status]) acc[status] = []
    acc[status].push(path)
    return acc
  }, {})

  // Order: Conflict (first, most urgent), Modified, Added, Untracked, Deleted
  const statusOrder = ['C', 'M', 'A', 'U', 'D']

  if (isLoading) {
    return (
      <div className="git-changes-view">
        <div className="git-changes-loading">
          <Loader2 className="git-inline-spinner" size={14} />
          <span>Loading changes...</span>
        </div>
      </div>
    )
  }

  if (gitStatus?.available === false) {
    return (
      <div className="git-changes-view">
        <div className="git-changes-error">
          <div>Git not available</div>
          <button type="button" className="git-changes-retry" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="git-changes-view">
        <div className="git-changes-error">
          <div>{error.message || String(error)}</div>
          <button type="button" className="git-changes-retry" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const totalChanges = Object.keys(changes).length

  if (totalChanges === 0) {
    return (
      <div className="git-changes-view">
        <div className="git-changes-empty empty-state">
          <span className="empty-state-icon-wrap git-changes-empty-icon-wrap" aria-hidden="true">
            <GitBranch className="git-changes-empty-icon" size={20} />
          </span>
          <span className="empty-state-title">Working tree is clean</span>
          <span className="empty-state-message">No modified, added, or deleted files right now.</span>
          <span className="empty-state-hint git-changes-empty-subtitle">
            <Command size={14} aria-hidden="true" />
            <span>Edit and save a file to generate a diff</span>
          </span>
        </div>
        {githubEnabled && (
          <div className="git-changes-github-connect">
            <ConnectGitHubButton workspaceId={workspaceId} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="git-changes-view">
      <div className="git-changes-summary">
        {totalChanges} changed file{totalChanges !== 1 ? 's' : ''}
        {githubEnabled && <ConnectGitHubButton workspaceId={workspaceId} />}
      </div>
      <div className="git-changes-list">
        {statusOrder.map((status) => {
          const files = groupedChanges[status]
          if (!files || files.length === 0) return null
          const config = STATUS_CONFIG[status]

          return (
            <div key={status} className="git-changes-group">
              <div className="git-changes-group-header">
                <span className={`git-status-badge ${config.className}`}>
                  {config.icon}
                </span>
                <span className="git-changes-group-label">
                  {config.label} ({files.length})
                </span>
              </div>
              {files.map((path) => {
                const isActive = activeDiffFile === path
                return (
                  <div
                    key={path}
                    className={`git-change-item ${isActive ? 'git-change-item-active' : ''}`}
                    onClick={() => handleFileClick(path, status)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleFileClick(path, status)
                      }
                    }}
                  >
                    <span className="git-change-icon"><FileText size={14} /></span>
                    <div className="git-change-info">
                      <span className={`git-change-name file-name-${status.toLowerCase()}`}>
                        {getFileName(path)}
                      </span>
                      {getDirectory(path) && (
                        <span className="git-change-path">{getDirectory(path)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
