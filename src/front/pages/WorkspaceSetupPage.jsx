import { useCallback, useEffect } from 'react'
import { Rocket, ArrowRight, Github, ExternalLink, Loader2, Check } from 'lucide-react'
import { useGitHubConnection } from '../components/GitHubConnect'
import PageShell from './PageShell'

/**
 * Post-creation onboarding wizard.
 * Currently a single-step wizard for GitHub connection (skippable).
 * Can be extended with more steps later.
 */
export default function WorkspaceSetupPage({ workspaceId, workspaceName, capabilities, onComplete }) {
  const githubEnabled = capabilities?.features?.github === true
  const { status, loading, connect } = useGitHubConnection(workspaceId, { enabled: githubEnabled })

  const handleDone = useCallback(() => {
    onComplete?.()
  }, [onComplete])

  // If GitHub is not enabled, skip the wizard entirely
  useEffect(() => {
    if (!githubEnabled) handleDone()
  }, [githubEnabled, handleDone])

  if (!githubEnabled) return null

  const connected = status?.connected

  return (
    <PageShell title={`Set up ${workspaceName || 'Workspace'}`}>
      <div className="setup-wizard">
        <div className="setup-wizard-header">
          <Rocket size={24} />
          <h2 className="setup-wizard-title">Get started</h2>
          <p className="setup-wizard-subtitle">
            Connect your workspace to version control in one click.
          </p>
        </div>

        <div className="setup-wizard-step">
          {loading ? (
            <div className="setup-wizard-loading">
              <Loader2 className="git-inline-spinner" size={16} />
              <span>Checking GitHub status...</span>
            </div>
          ) : connected ? (
            <div className="setup-wizard-connected">
              <Check size={16} />
              <span>GitHub connected</span>
            </div>
          ) : (
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              onClick={connect}
            >
              <Github size={16} />
              Connect GitHub
              <ExternalLink size={14} />
            </button>
          )}
        </div>

        <div className="setup-wizard-footer">
          <button
            type="button"
            className="settings-btn settings-btn-primary setup-wizard-continue"
            onClick={handleDone}
          >
            {connected ? 'Continue to workspace' : 'Skip for now'}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </PageShell>
  )
}
