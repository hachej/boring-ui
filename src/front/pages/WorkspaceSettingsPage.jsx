import { useState, useEffect } from 'react'
import { Loader2, Cog, Activity, Lock, AlertTriangle, Copy, Check, Github } from 'lucide-react'
import { apiFetchJson } from '../utils/transport'
import { buildApiUrl } from '../utils/apiBase'
import { routes } from '../utils/routes'
import PageShell, { SettingsSection, SettingsField } from './PageShell'
import GitHubConnect from '../components/GitHubConnect'

export default function WorkspaceSettingsPage({ workspaceId, capabilities }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [runtime, setRuntime] = useState(null)
  const [settings, setSettings] = useState({})
  const [workspaceName, setWorkspaceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [workspaceIdCopied, setWorkspaceIdCopied] = useState(false)

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

        const workspaces = workspacesResult.data?.workspaces || []
        const ws = workspaces.find((w) => w.id === workspaceId)
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

  const runtimeState = runtime?.state || runtime?.status || 'unknown'
  const runtimeRetryable = runtime?.retryable === true || runtimeState === 'error'
  const runtimeError = runtime?.last_error || ''

  const settingKeys = Object.keys(settings)

  return (
    <PageShell title="Workspace Settings" backHref={backHref}>
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

        <SettingsSection title="Runtime" icon={Activity}>
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
        </SettingsSection>

        {capabilities?.features?.github && (
          <SettingsSection title="GitHub Integration" icon={Github} description="Sync workspace files to a private GitHub repository">
            <SettingsField label="Connection">
              <GitHubConnect workspaceId={workspaceId} />
            </SettingsField>
          </SettingsSection>
        )}

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
