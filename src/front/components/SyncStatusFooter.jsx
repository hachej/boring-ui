import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Check, FolderOpen, GitBranch, GitMerge, Cloud, Loader2, AlertTriangle, CloudOff,
  MoreHorizontal, RefreshCw, Pause, Play, GitBranchPlus, ChevronRight, MessageSquare,
} from 'lucide-react'
import { useGitStatus, useGitBranch } from '../providers/data'
import { useDataProvider } from '../providers/data/DataContext'
import { useAutoSync } from '../hooks/useAutoSync'
import Tooltip from './Tooltip'

const DEFAULT_SYNC_INTERVAL = 10000
const SYNC_INTERVAL_KEY = 'boring-ui:sync-interval'

const getSyncInterval = () => {
  try {
    const val = parseInt(localStorage.getItem(SYNC_INTERVAL_KEY), 10)
    return val >= 5000 ? val : DEFAULT_SYNC_INTERVAL
  } catch { return DEFAULT_SYNC_INTERVAL }
}

/** Inject a prompt into the agent chat input (works across shadow DOM). */
const askAgent = (prompt) => {
  // Fire event for React-based chat (ClaudeStreamChat / Companion Composer)
  window.dispatchEvent(new CustomEvent('boring-ui:agent-prompt', { detail: { prompt } }))
  // Also reach into shadow DOM textarea (native Lit-based chat panel)
  try {
    const shadowHost = document.querySelector('[style*="display: flex"]')
    const roots = []
    document.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) roots.push(el.shadowRoot) })
    for (const root of roots) {
      const ta = root.querySelector('textarea')
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (setter) {
          setter.call(ta, prompt)
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        }
        ta.focus()
        return
      }
    }
  } catch { /* fallback to event only */ }
}

/**
 * Sync status footer for the file tree sidebar.
 *
 * Shows: [branch indicator] [sync state] [...menu]
 *
 * Menu provides: sync now, pause/resume auto-sync, switch branch.
 */
export default function SyncStatusFooter({ githubConnected, viewMode, onSetViewMode }) {
  const provider = useDataProvider()
  const { data: gitData } = useGitStatus()
  const { data: branch, refetch: refetchBranch } = useGitBranch({ refetchInterval: 30000 })
  const isRepo = gitData?.is_repo

  const [syncInterval, setSyncInterval] = useState(getSyncInterval)
  // Re-read interval when another tab/component updates it
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === SYNC_INTERVAL_KEY) setSyncInterval(getSyncInterval())
    }
    window.addEventListener('storage', onStorage)
    // Also listen for same-tab updates via custom event
    const onLocalUpdate = () => setSyncInterval(getSyncInterval())
    window.addEventListener('boring-ui:sync-interval-changed', onLocalUpdate)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('boring-ui:sync-interval-changed', onLocalUpdate)
    }
  }, [])

  const [paused, setPaused] = useState(false)
  const { state: syncState, lastError, lastSyncTimestamp, syncNow } = useAutoSync({
    enabled: isRepo && githubConnected && !paused,
    pushEnabled: !!githubConnected,
    initialPull: !!githubConnected,
    intervalMs: syncInterval,
  })

  // Countdown to next sync
  const [secondsLeft, setSecondsLeft] = useState(null)
  useEffect(() => {
    if (!lastSyncTimestamp || syncState !== 'idle') {
      setSecondsLeft(null)
      return
    }
    const tick = () => {
      const elapsed = Date.now() - lastSyncTimestamp
      const remaining = Math.max(0, Math.ceil((syncInterval - elapsed) / 1000))
      setSecondsLeft(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastSyncTimestamp, syncState, syncInterval])

  // Menu state
  const [menuOpen, setMenuOpen] = useState(false)
  const [branchSubmenuOpen, setBranchSubmenuOpen] = useState(false)
  const [branches, setBranches] = useState(null)
  const [newBranchName, setNewBranchName] = useState('')
  const [switching, setSwitching] = useState(false)
  const [menuError, setMenuError] = useState(null)
  const menuRef = useRef(null)
  const branchBtnRef = useRef(null)
  const [submenuPos, setSubmenuPos] = useState(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
        setBranchSubmenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  // Fetch branches when submenu opens; reset on close
  useEffect(() => {
    if (!branchSubmenuOpen) {
      setBranches(null)
      setSubmenuPos(null)
      return
    }
    // Calculate flyout position from the "Switch branch" button
    if (branchBtnRef.current) {
      const r = branchBtnRef.current.getBoundingClientRect()
      setSubmenuPos({ top: r.top, left: r.right + 4 })
    }
    let cancelled = false
    provider.git.branches().then((data) => {
      if (!cancelled) setBranches(data.branches || [])
    }).catch(() => {
      if (!cancelled) setBranches([])
    })
    return () => { cancelled = true }
  }, [branchSubmenuOpen, provider])

  const handleCheckout = useCallback(async (name) => {
    setSwitching(true)
    setMenuError(null)
    try {
      await provider.git.checkout(name)
      refetchBranch()
      setMenuOpen(false)
      setBranchSubmenuOpen(false)
    } catch (err) {
      setMenuError(`Checkout failed: ${err.message || 'unknown error'}`)
    } finally {
      setSwitching(false)
    }
  }, [provider, refetchBranch])

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim()
    if (!name) return
    if (/[\s~^:\\]|\.\./.test(name)) {
      setMenuError('Invalid branch name — avoid spaces, .., ~, ^, :, \\')
      return
    }
    setSwitching(true)
    setMenuError(null)
    try {
      await provider.git.createBranch(name, true)
      refetchBranch()
      setNewBranchName('')
      setMenuOpen(false)
      setBranchSubmenuOpen(false)
    } catch (err) {
      setMenuError(`Create branch failed: ${err.message || 'unknown error'}`)
    } finally {
      setSwitching(false)
    }
  }, [provider, newBranchName, refetchBranch])

  if (!isRepo) return null

  const branchLabel = branch || null
  const isMain = branch === 'main' || branch === 'master'

  const syncIcon = () => {
    if (paused) return <Pause size={12} />
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

  const syncClass = () => {
    if (paused) return 'sync-state--paused'
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

  const tooltipLabel = (() => {
    if (paused) return 'Auto-sync paused'
    if (lastError) return lastError
    if (syncState === 'syncing') return 'Committing & pushing...'
    if (syncState === 'idle' && secondsLeft != null) {
      return `All changes synced · next check in ${secondsLeft}s`
    }
    return 'All changes synced'
  })()

  return (
    <div className="sync-status-footer" ref={menuRef}>
      {branchLabel && (
        <Tooltip label={`Branch: ${branchLabel}`}>
          <span className={`sync-branch ${isMain ? '' : 'sync-branch--draft'}`}>
            <GitBranch size={12} />
            <span className="sync-branch-name">{branchLabel}</span>
          </span>
        </Tooltip>
      )}
      {onSetViewMode && (
        <div className="sync-footer-view-toggle">
          <Tooltip label="Files">
            <button
              type="button"
              className={`sync-footer-toggle-btn${viewMode === 'files' ? ' active' : ''}`}
              onClick={() => onSetViewMode('files')}
              aria-label="File tree view"
            >
              <FolderOpen size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Changes">
            <button
              type="button"
              className={`sync-footer-toggle-btn${viewMode === 'changes' ? ' active' : ''}`}
              onClick={() => onSetViewMode('changes')}
              aria-label="Git changes view"
            >
              <GitBranch size={12} />
            </button>
          </Tooltip>
        </div>
      )}
      <span className="sync-state-spacer" />
      <Tooltip label={tooltipLabel}>
        <button
          type="button"
          className={`sync-state ${syncClass()}`}
          onClick={syncNow}
          disabled={syncState === 'syncing' || paused}
        >
          {syncIcon()}
        </button>
      </Tooltip>
      <Tooltip label="Sync options">
        <button
          type="button"
          className={`sync-menu-trigger${menuOpen ? ' sync-menu-trigger--active' : ''}`}
          onClick={() => { setMenuOpen(!menuOpen); setBranchSubmenuOpen(false); setMenuError(null) }}
          aria-label="Sync options"
        >
          <MoreHorizontal size={14} />
        </button>
      </Tooltip>
      {menuOpen && (
        <div className="sync-menu">
          {menuError && (
            <div className="sync-menu-error">
              <AlertTriangle size={12} />
              <span>{menuError}</span>
            </div>
          )}
          <button
            type="button"
            className="sync-menu-item"
            onClick={() => { syncNow(); setMenuOpen(false) }}
            disabled={syncState === 'syncing' || paused}
          >
            <RefreshCw size={13} />
            <span>Sync now</span>
          </button>
          <button
            type="button"
            className="sync-menu-item"
            onClick={() => { setPaused(!paused); setMenuOpen(false) }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            <span>{paused ? 'Resume auto-sync' : 'Pause auto-sync'}</span>
          </button>
          <div className="sync-menu-divider" />
          <button
            ref={branchBtnRef}
            type="button"
            className="sync-menu-item sync-menu-item--submenu"
            onClick={() => setBranchSubmenuOpen(!branchSubmenuOpen)}
          >
            <GitBranch size={13} />
            <span>Switch branch</span>
            <ChevronRight size={12} className="sync-menu-chevron" />
          </button>
          {branchSubmenuOpen && submenuPos && (
            <div
              className="sync-branch-submenu"
              style={{ top: submenuPos.top, left: submenuPos.left }}
            >
              {branches === null ? (
                <div className="sync-menu-item sync-menu-item--loading">
                  <Loader2 size={13} className="git-inline-spinner" />
                  <span>Loading...</span>
                </div>
              ) : (
                <>
                  {branches.map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`sync-menu-item${b === branch ? ' sync-menu-item--current' : ''}`}
                      onClick={() => b !== branch && handleCheckout(b)}
                      disabled={switching || b === branch}
                    >
                      {b === branch ? <Check size={13} /> : <GitBranch size={13} />}
                      <span>{b}</span>
                    </button>
                  ))}
                  <div className="sync-menu-divider" />
                  <div className="sync-branch-create">
                    <GitBranchPlus size={13} />
                    <input
                      type="text"
                      className="sync-branch-input"
                      placeholder="New branch..."
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateBranch()}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          <div className="sync-menu-divider" />
          <button
            type="button"
            className="sync-menu-item sync-menu-item--agent"
            onClick={() => {
              askAgent(`Create a new git branch from ${branch || 'main'} for my next feature. Ask me what to name it.`)
              setMenuOpen(false)
            }}
          >
            <GitBranchPlus size={13} />
            <span>Ask agent: create branch</span>
          </button>
          <button
            type="button"
            className="sync-menu-item sync-menu-item--agent"
            onClick={() => {
              askAgent(`Merge the current branch (${branch || 'main'}) — list available branches and ask me which one to merge, then perform the merge.`)
              setMenuOpen(false)
            }}
          >
            <GitMerge size={13} />
            <span>Ask agent: merge branch</span>
          </button>
          {syncState === 'conflict' && (
            <button
              type="button"
              className="sync-menu-item sync-menu-item--agent"
              onClick={() => {
                askAgent('There are git merge conflicts in my workspace. List the conflicted files, show me the conflicts, and help me resolve them.')
                setMenuOpen(false)
              }}
            >
              <MessageSquare size={13} />
              <span>Ask agent: resolve conflicts</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
