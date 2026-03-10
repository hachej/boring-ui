import { Check, GitBranch, Cloud, Loader2, AlertTriangle, CloudOff } from 'lucide-react'
import { useGitStatus, useGitBranch } from '../providers/data'
import { useAutoSync } from '../hooks/useAutoSync'
import Tooltip from './Tooltip'

/**
 * Sync status footer for the file tree sidebar.
 *
 * Shows: [branch indicator] [sync state icon + label]
 *
 * When githubConnected is true, starts the auto-sync engine which
 * commits dirty files and pushes to the remote every 10s.
 */
export default function SyncStatusFooter({ githubConnected }) {
  const { data: gitData } = useGitStatus()
  const { data: branch } = useGitBranch({ refetchInterval: 30000 })
  const isRepo = gitData?.is_repo

  const { state: syncState, lastError } = useAutoSync({
    enabled: isRepo && githubConnected,
    pushEnabled: !!githubConnected,
    initialPull: !!githubConnected,
    intervalMs: 10000,
  })

  if (!isRepo) return null

  const branchLabel = branch || null
  const isMain = branch === 'main' || branch === 'master'

  const syncIcon = () => {
    switch (syncState) {
      case 'syncing':
        return <Loader2 size={12} className="git-inline-spinner" />
      case 'error':
        return <AlertTriangle size={12} />
      case 'conflict':
        return <CloudOff size={12} />
      default:
        return githubConnected ? <Cloud size={12} /> : <Check size={12} />
    }
  }

  const syncLabel = () => {
    switch (syncState) {
      case 'syncing':
        return 'Syncing...'
      case 'error':
        return 'Sync error'
      case 'conflict':
        return 'Conflict'
      case 'idle':
        return 'Synced'
      default:
        return 'Saved'
    }
  }

  const syncClass = () => {
    switch (syncState) {
      case 'syncing':
        return 'sync-state--syncing'
      case 'error':
      case 'conflict':
        return 'sync-state--error'
      case 'idle':
        return 'sync-state--ok'
      default:
        return 'sync-state--ok'
    }
  }

  const tooltipLabel = lastError || (syncState === 'syncing' ? 'Committing & pushing...' : 'All changes synced')

  return (
    <div className="sync-status-footer">
      {branchLabel && (
        <Tooltip label={`Branch: ${branchLabel}`}>
          <span className={`sync-branch ${isMain ? '' : 'sync-branch--draft'}`}>
            <GitBranch size={12} />
            <span className="sync-branch-name">{branchLabel}</span>
          </span>
        </Tooltip>
      )}
      <span className="sync-state-spacer" />
      <Tooltip label={tooltipLabel}>
        <span className={`sync-state ${syncClass()}`}>
          {syncIcon()}
          <span>{syncLabel()}</span>
        </span>
      </Tooltip>
    </div>
  )
}
