import { useState, useEffect, useRef } from 'react'
import { Loader2, Cog, Activity, Lock, AlertTriangle, Copy, Check, Github, ChevronDown, RefreshCw } from 'lucide-react'
import { apiFetchJson } from '../utils/transport'
import { buildApiUrl } from '../utils/apiBase'
import { routes } from '../utils/routes'
import PageShell, { SettingsSection, SettingsField } from './PageShell'
import GitHubConnect from '../components/GitHubConnect'

/**
 * Inline workspace switcher — dropdown that lists all workspaces
 * and navigates to the selected one's settings page.
 */
function WorkspaceSwitcher({ workspaces, currentId }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const current = workspaces.find((w) => (w.workspace_id || w.id) === currentId)
  const displayName = current?.name || currentId

  if (workspaces.length <= 1) {
    return <span className="ws-switcher-solo">{displayName}</span>
  }

  return (
    <div className="ws-switcher" ref={ref}>
      <button
        type="button"
        className="ws-switcher-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="ws-switcher-name">{displayName}</span>
        <ChevronDown size={14} className={`ws-switcher-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="ws-switcher-dropdown">
          {workspaces.map((ws) => {
            const wsId = ws.workspace_id || ws.id
            const active = wsId === currentId
            return (
              <a
                key={wsId}
                className={`ws-switcher-item ${active ? 'active' : ''}`}
                href={routes.controlPlane.workspaces.scope(wsId, 'settings').path}
                onClick={() => setOpen(false)}
              >
                <span className="ws-switcher-item-name">{ws.name || wsId}</span>
                {active && <Check size={12} />}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function WorkspaceSettingsPage({ workspaceId, capabilities }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [runtime, setRuntime] = useState(null)
  const [settings, setSettings] = useState({})
  const [workspaces, setWorkspaces] = useState([])
  const [workspaceName, setWorkspaceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [workspaceIdCopied, setWorkspaceIdCopied] = useState(false)

  // Sync interval (localStorage-backed)
  const SYNC_INTERVAL_KEY = 'boring-ui:sync-interval'
  const DEFAULT_SYNC_INTERVAL = 10000
  const SYNC_INTERVAL_OPTIONS = [
    { label: '5 seconds', value: 5000 },
    { label: '10 seconds', value: 10000 },
    { label: '30 seconds', value: 30000 },
    { label: '1 minute', value: 60000 },
    { label: '5 minutes', value: 300000 },
  ]
  const [syncInterval, setSyncIntervalState] = useState(() => {
    try {
      const val = parseInt(localStorage.getItem(SYNC_INTERVAL_KEY), 10)
      return val >= 5000 ? val : DEFAULT_SYNC_INTERVAL
    } catch { return DEFAULT_SYNC_INTERVAL }
  })
  const handleSyncIntervalChange = (value) => {
    const ms = parseInt(value, 10)
    setSyncIntervalState(ms)
    localStorage.setItem(SYNC_INTERVAL_KEY, String(ms))
    window.dispatchEvent(new Event('boring-ui:sync-interval-changed'))
  }

  const backRoute = routes.controlPlane.workspaces.scope(workspaceId)
  const backHref = backRoute.path

  useEffect(() => {
    const load = async () => {
      try {
        const [workspacesResult, runtimeResult, settingsResult] = await Promise.all([
          apiFetchJson(routes.controlPlane.workspaces.list().path),
          apiFetchJson(routes.controlPlane.workspaces.runtime.get(workspaceId).path),
          apiFetchJson(routes.controlPlane.workspaces.settings.get(workspaceId).path),
        ])

        if (workspacesResult.response.status === 401) {
          const loginRoute = routes.controlPlane.auth.login(window.location.pathname)
          window.location.assign(buildApiUrl(loginRoute.path, loginRoute.query))
          return
        }

        const wsList = workspacesResult.data?.workspaces || []
        setWorkspaces(wsList)
        const ws = wsList.find((w) => (w.workspace_id || w.id) === workspaceId)
        if (ws) {
          setWorkspaceName(ws.name || '')
        }

        if (runtimeResult.response.ok) {
          setRuntime(runtimeResult.data?.runtime || runtimeResult.data)
        }

        if (settingsResult.response.ok) {
          setSettings(settingsResult.data?.settings || settingsResult.data?.data?.workspace_settings || {})
        }
      } catch {
        setError('Failed to load workspace data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [workspaceId])

  const handleSaveName = async () => {
    setSaving(true)
    setSaveMessage('')
    try {
      const route = routes.controlPlane.workspaces.update
        ? routes.controlPlane.workspaces.update(workspaceId)
        : { path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, query: undefined }
      const { response } = await apiFetchJson(route.path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceName }),
      })
      if (response.ok) {
        setSaveMessage('Workspace name saved')
        setTimeout(() => setSaveMessage(''), 3000)
      } else {
        setSaveMessage('Failed to save name')
      }
    } catch {
      setSaveMessage('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleRetryRuntime = async () => {
    setRetrying(true)
    try {
      const route = routes.controlPlane.workspaces.runtime.retry(workspaceId)
      const { response, data } = await apiFetchJson(route.path, { method: 'POST' })
      if (response.ok) {
        setRuntime(data?.runtime || data)
      }
    } catch {
      // retry errors shown via runtime state
    } finally {
      setRetrying(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const route = routes.controlPlane.workspaces.delete
        ? routes.controlPlane.workspaces.delete(workspaceId)
        : { path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, query: undefined }
      const { response } = await apiFetchJson(route.path, { method: 'DELETE' })
      if (response.ok) {
        window.location.assign('/')
      } else {
        setShowDeleteConfirm(false)
        setDeleting(false)
      }
    } catch {
      setShowDeleteConfirm(false)
      setDeleting(false)
    }
  }

  const handleCopyWorkspaceId = async () => {
    try {
      await navigator.clipboard.writeText(workspaceId)
      setWorkspaceIdCopied(true)
      setTimeout(() => setWorkspaceIdCopied(false), 1500)
    } catch {
      // Ignore clipboard errors silently to avoid noisy UX.
    }
  }

  const headerTitle = (
    <span className="settings-header-title-group">
      <WorkspaceSwitcher workspaces={workspaces} currentId={workspaceId} />
      <span className="settings-header-separator">/</span>
      <span>Settings</span>
    </span>
  )

  if (loading) {
    return (
      <PageShell title="Workspace Settings" backHref={backHref}>
        <div className="page-loading">
          <Loader2 className="page-loading-icon" size={32} />
          <span>Loading workspace settings...</span>
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell title="Workspace Settings" backHref={backHref}>
        <div className="page-error">{error}</div>
      </PageShell>
    )
  }

  const runtimeState = runtime?.state || runtime?.status || ''
  const runtimeRetryable = runtime?.retryable === true || runtimeState === 'error'
  const runtimeError = runtime?.last_error || ''
  // Only show runtime section when there's a real runtime (hosted/edge mode with sprites)
  const hasRuntime = runtime && runtimeState && runtimeState !== 'unknown' && runtimeState !== 'pending' && runtimeState !== 'provisioning'

  // Filter out workspace metadata keys — only show actual encrypted settings
  const metadataKeys = new Set(['created_at', 'updated_at', 'workspace_id', 'deleted_at', 'app_id', 'name', 'created_by'])
  const settingKeys = Object.keys(settings).filter((k) => !metadataKeys.has(k))

  return (
    <PageShell title={headerTitle} backHref={backHref}>
      <div className="settings-card">
        <SettingsSection title="General" icon={Cog}>
          <SettingsField label="Workspace Name">
            <div className="settings-field-inline">
              <input
                type="text"
                className="settings-input"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Workspace name"
              />
              <button
                type="button"
                className="settings-btn settings-btn-primary"
                onClick={handleSaveName}
                disabled={saving || !workspaceName.trim()}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
            {saveMessage && (
              <span className={`settings-save-message ${saveMessage.includes('Failed') ? 'error' : 'success'}`}>
                {saveMessage}
              </span>
            )}
          </SettingsField>
          <SettingsField label="Workspace ID" description="Unique identifier for this workspace">
            <div className="settings-field-inline">
              <input
                type="text"
                className="settings-input settings-input-mono"
                value={workspaceId}
                disabled
              />
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                onClick={handleCopyWorkspaceId}
                aria-label="Copy workspace ID"
              >
                {workspaceIdCopied ? <Check size={14} /> : <Copy size={14} />}
                {workspaceIdCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </SettingsField>
        </SettingsSection>

        {capabilities?.features?.github && (
          <SettingsSection title="GitHub Integration" icon={Github} description="Sync workspace files to a private GitHub repository">
            <GitHubConnect workspaceId={workspaceId} />
          </SettingsSection>
        )}

        <SettingsSection title="Auto-Sync" icon={RefreshCw} description="Automatically commit and push changes at a regular interval">
          <SettingsField label="Sync Frequency" description="How often to check for changes and sync">
            <select
              className="settings-input settings-select"
              value={syncInterval}
              onChange={(e) => handleSyncIntervalChange(e.target.value)}
            >
              {SYNC_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </SettingsField>
        </SettingsSection>

        {hasRuntime && <SettingsSection title="Runtime" icon={Activity}>
          <SettingsField label="Status">
            <div className="settings-runtime-status">
              <span className={`settings-runtime-badge settings-runtime-badge-${runtimeState}`}>
                {runtimeState}
              </span>
              {runtimeRetryable && (
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  onClick={handleRetryRuntime}
                  disabled={retrying}
                >
                  {retrying ? 'Retrying...' : 'Retry'}
                </button>
              )}
            </div>
          </SettingsField>
          {runtimeError && (
            <SettingsField label="Last Error">
              <div className="settings-runtime-error">{runtimeError}</div>
            </SettingsField>
          )}
          {runtime?.sprite_url && (
            <SettingsField label="Sprite URL">
              <input
                type="text"
                className="settings-input settings-input-mono"
                value={runtime.sprite_url}
                disabled
              />
            </SettingsField>
          )}
        </SettingsSection>}

        {settingKeys.length > 0 && (
          <SettingsSection title="Configuration" icon={Lock} description="Encrypted workspace settings">
            {settingKeys.map((key) => (
              <SettingsField key={key} label={key}>
                <span className="settings-configured-badge">
                  Configured
                  {settings[key]?.updated_at && (
                    <span className="settings-configured-date">
                      {' '}— {new Date(settings[key].updated_at).toLocaleDateString()}
                    </span>
                  )}
                </span>
              </SettingsField>
            ))}
          </SettingsSection>
        )}

        <SettingsSection title="Danger Zone" icon={AlertTriangle} danger>
          <SettingsField label="Delete Workspace" description="Permanently delete this workspace and all its data">
            {showDeleteConfirm ? (
              <div className="settings-delete-confirm">
                <span className="settings-delete-warning">This action cannot be undone.</span>
                <div className="settings-delete-actions">
                  <button
                    type="button"
                    className="settings-btn settings-btn-danger"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                  <button
                    type="button"
                    className="settings-btn settings-btn-secondary"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="settings-btn settings-btn-danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete Workspace
              </button>
            )}
          </SettingsField>
        </SettingsSection>
      </div>
    </PageShell>
  )
}
