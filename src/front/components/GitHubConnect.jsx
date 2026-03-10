import { useState, useEffect, useCallback } from 'react'
import { Github, ExternalLink, Unlink, Loader2, AlertCircle } from 'lucide-react'
import { apiFetchJson } from '../utils/transport'
import { routes } from '../utils/routes'

/**
 * Hook for GitHub connection state and actions.
 * Shared by all GitHub connection UI surfaces.
 */
export function useGitHubConnection(workspaceId, { enabled = true } = {}) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')

  const fetchStatus = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    try {
      const route = routes.github.status(workspaceId)
      const qs = route.query ? '?' + new URLSearchParams(route.query).toString() : ''
      const { data } = await apiFetchJson(route.path + qs)

      // Auto-connect: if configured but not connected, check for existing installations
      if (data?.configured && !data?.connected && workspaceId) {
        try {
          const { data: instData } = await apiFetchJson(routes.github.installations().path)
          const installations = instData?.installations || []
          if (installations.length > 0) {
            const installationId = installations[0].id
            const { response } = await apiFetchJson(routes.github.connect().path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspace_id: workspaceId, installation_id: installationId }),
            })
            if (response.ok) {
              setStatus({ configured: true, connected: true, installation_id: installationId })
              return
            }
          }
        } catch {
          // Auto-connect failed silently — show normal disconnected state
        }
      }

      setStatus(data)
    } catch {
      setError('Failed to check GitHub status')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, enabled])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // Listen for OAuth callback via postMessage from popup
  useEffect(() => {
    const handler = (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'github-callback' && event.data?.success) {
        fetchStatus()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [fetchStatus])

  const connect = useCallback(async () => {
    // First check if the app is already installed — auto-connect if so
    try {
      const { data: instData } = await apiFetchJson(routes.github.installations().path)
      const installations = instData?.installations || []
      if (installations.length > 0 && workspaceId) {
        // App is already installed — connect directly without leaving the page
        const installationId = installations[0].id
        await apiFetchJson(routes.github.connect().path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: workspaceId, installation_id: installationId }),
        })
        fetchStatus()
        return
      }
    } catch {
      // Fall through to installation flow
    }

    // No installation found — open GitHub App install page
    const authPath = routes.github.authorize().path
    const url = workspaceId ? `${authPath}?workspace_id=${encodeURIComponent(workspaceId)}` : authPath
    window.open(url, '_blank')
  }, [workspaceId, fetchStatus])

  const disconnect = useCallback(async () => {
    setDisconnecting(true)
    try {
      await apiFetchJson(routes.github.disconnect().path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      })
      setStatus({ configured: true, connected: false })
    } catch {
      setError('Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }, [workspaceId])

  return { status, loading, error, disconnecting, connect, disconnect, refetch: fetchStatus }
}

/**
 * Full GitHub connection UI for the workspace settings page.
 * Shows status, connect/disconnect buttons, installation info.
 */
export default function GitHubConnect({ workspaceId }) {
  const { status, loading, error, disconnecting, connect, disconnect } = useGitHubConnection(workspaceId)
  const [repos, setRepos] = useState([])

  useEffect(() => {
    if (!status?.connected || !status?.installation_id) { setRepos([]); return }
    apiFetchJson(`${routes.github.repos().path}?installation_id=${status.installation_id}`)
      .then(({ data }) => setRepos(data?.repos || []))
      .catch(() => setRepos([]))
  }, [status?.connected, status?.installation_id])

  return (
    <div className="github-connect-full">
      {loading ? (
        <div className="github-connect-loading">
          <Loader2 className="git-inline-spinner" size={14} />
          <span>Checking connection...</span>
        </div>
      ) : !status?.configured ? (
        <div className="github-connect-unconfigured">
          <span className="settings-configured-badge">Not configured</span>
          <span className="github-connect-hint">
            GitHub App not configured on this server.
          </span>
        </div>
      ) : status?.connected ? (
        <div className="github-connect-connected">
          <div className="github-connect-status-row">
            <span className="settings-runtime-badge settings-runtime-badge-running">
              Connected
            </span>
            {status.installation_id && (
              <span className="github-connect-installation">
                Installation #{status.installation_id}
              </span>
            )}
          </div>
          {repos.length > 0 && (
            <div className="github-connect-repos">
              {repos.map((repo) => (
                <a
                  key={repo.full_name}
                  className="github-connect-repo-link"
                  href={repo.clone_url?.replace(/\.git$/, '') || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github size={14} />
                  <span>{repo.full_name}</span>
                  <ExternalLink size={12} />
                </a>
              ))}
            </div>
          )}
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            onClick={disconnect}
            disabled={disconnecting}
          >
            <Unlink size={14} />
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div className="github-connect-disconnected">
          <span className="settings-runtime-badge settings-runtime-badge-pending">
            Not connected
          </span>
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={connect}
          >
            <Github size={16} />
            Connect GitHub
            <ExternalLink size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="github-connect-error">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </div>
  )
}
