import React, { useMemo } from 'react'
import { Check, FileText } from 'lucide-react'
import { useGitStatus } from '../providers/data'

const STATUS_CONFIG = {
  M: { label: 'Modified', className: 'git-status-modified', icon: 'M' },
  U: { label: 'Untracked', className: 'git-status-new', icon: 'U' },
  A: { label: 'Added', className: 'git-status-added', icon: 'A' },
  D: { label: 'Deleted', className: 'git-status-deleted', icon: 'D' },
  C: { label: 'Conflict', className: 'git-status-conflict', icon: 'C' },
}

export default function GitChangesView({ onOpenDiff, activeDiffFile }) {
  const { data: gitStatus, isLoading, error } = useGitStatus({ refetchInterval: 5000 })

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
        <div className="git-changes-loading">Loading changes...</div>
      </div>
    )
  }

  if (gitStatus?.available === false) {
    return (
      <div className="git-changes-view">
        <div className="git-changes-error">Git not available</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="git-changes-view">
        <div className="git-changes-error">{error.message || String(error)}</div>
      </div>
    )
  }

  const totalChanges = Object.keys(changes).length

  if (totalChanges === 0) {
    return (
      <div className="git-changes-view">
        <div className="git-changes-empty">
          <Check className="git-changes-empty-icon" size={24} />
          <span>No changes</span>
          <span className="git-changes-empty-subtitle">Working tree is clean.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="git-changes-view">
      <div className="git-changes-summary">
        {totalChanges} changed file{totalChanges !== 1 ? 's' : ''}
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
