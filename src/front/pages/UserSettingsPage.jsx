import { useState, useEffect, useRef } from 'react'
import { Loader2, User, Palette, Shield, KeyRound } from 'lucide-react'
import { apiFetchJson } from '../utils/transport'
import { routeHref, routes } from '../utils/routes'
import { useTheme } from '../hooks/useTheme'
import {
  listPiProviderKeyStatus,
  maskPiProviderKey,
  removePiProviderKey,
  resolvePiProviderKeyScope,
  setPiProviderKey,
} from '../providers/pi/providerKeys'
import PageShell, { SettingsSection, SettingsField } from './PageShell'

export default function UserSettingsPage({ workspaceId }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [providerKeyScope, setProviderKeyScope] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileSaveMessage, setProfileSaveMessage] = useState('')
  const [profileSaveMessageTone, setProfileSaveMessageTone] = useState('success')
  const [providerKeys, setProviderKeys] = useState([])
  const [providerKeyDrafts, setProviderKeyDrafts] = useState({})
  const [providerKeyPending, setProviderKeyPending] = useState({})
  const [providerKeyMessage, setProviderKeyMessage] = useState('')
  const [providerKeyMessageTone, setProviderKeyMessageTone] = useState('success')
  const { theme, toggleTheme } = useTheme()
  const profileMessageTimerRef = useRef(null)
  const providerKeyMessageTimerRef = useRef(null)

  const backRoute = workspaceId
    ? routes.controlPlane.workspaces.scope(workspaceId)
    : { path: '/', query: undefined }
  const backHref = backRoute.path

  useEffect(() => () => {
    if (profileMessageTimerRef.current) {
      clearTimeout(profileMessageTimerRef.current)
    }
    if (providerKeyMessageTimerRef.current) {
      clearTimeout(providerKeyMessageTimerRef.current)
    }
  }, [])

  const updateProfileSaveMessage = (message, tone = 'success') => {
    if (profileMessageTimerRef.current) {
      clearTimeout(profileMessageTimerRef.current)
      profileMessageTimerRef.current = null
    }
    setProfileSaveMessage(message)
    setProfileSaveMessageTone(tone)
    if (message) {
      profileMessageTimerRef.current = setTimeout(() => {
        setProfileSaveMessage('')
        setProfileSaveMessageTone('success')
        profileMessageTimerRef.current = null
      }, 3000)
    }
  }

  const updateProviderKeyMessage = (message, tone = 'success') => {
    if (providerKeyMessageTimerRef.current) {
      clearTimeout(providerKeyMessageTimerRef.current)
      providerKeyMessageTimerRef.current = null
    }
    setProviderKeyMessage(message)
    setProviderKeyMessageTone(tone)
    if (message) {
      providerKeyMessageTimerRef.current = setTimeout(() => {
        setProviderKeyMessage('')
        setProviderKeyMessageTone('success')
        providerKeyMessageTimerRef.current = null
      }, 3000)
    }
  }

  useEffect(() => {
    const load = async () => {
      let resolvedUserId = ''
      let resolvedProviderKeyScope = resolvePiProviderKeyScope('')
      let shouldLoadProviderKeys = true
      try {
        try {
          const meRoute = routes.controlPlane.me.get()
          const { response, data } = await apiFetchJson(meRoute.path, { query: meRoute.query })
          if (!response.ok) {
            if (response.status === 401) {
              // No active session — show settings without profile data.
              // Profile section will be hidden; theme/appearance still works.
              resolvedUserId = ''
            } else {
              shouldLoadProviderKeys = false
              setError('Failed to load user info')
            }
          } else {
            resolvedUserId = String(data.user_id || data.user?.user_id || '')
            resolvedProviderKeyScope = resolvePiProviderKeyScope(resolvedUserId)
            setProviderKeyScope(resolvedProviderKeyScope)
            setEmail(data.email || data.user?.email || '')
            setDisplayName(data.display_name || data.user?.display_name || '')
          }
        } catch {
          // Backend unreachable — show settings without profile data
        }

        if (!resolvedUserId) {
          setProviderKeyScope(resolvedProviderKeyScope)
        }

        if (shouldLoadProviderKeys) {
          try {
            const nextProviderKeys = await listPiProviderKeyStatus(resolvedProviderKeyScope)
            setProviderKeys(nextProviderKeys)
          } catch {
            updateProviderKeyMessage('Failed to load agent API keys', 'error')
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setProfileSaveMessage('')
    try {
      const settingsRoute = routes.controlPlane.me.settings
        ? routes.controlPlane.me.settings.update()
        : { path: '/api/v1/me/settings', query: undefined }
      const { response } = await apiFetchJson(settingsRoute.path, {
        query: settingsRoute.query,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      })
      if (!response.ok) {
        throw new Error('Failed to save profile')
      }
      updateProfileSaveMessage('Settings saved', 'success')
    } catch {
      updateProfileSaveMessage('Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleProviderKeyDraftChange = (providerId, value) => {
    setProviderKeyDrafts((current) => ({
      ...current,
      [providerId]: value,
    }))
  }

  const handleProviderKeySave = async (provider) => {
    const nextValue = String(providerKeyDrafts[provider.id] || '').trim()
    if (!nextValue) {
      updateProviderKeyMessage(`Enter a ${provider.label} API key before saving`, 'error')
      return
    }

    setProviderKeyPending((current) => ({ ...current, [provider.id]: 'saving' }))
    updateProviderKeyMessage('')
    try {
      const result = await setPiProviderKey(providerKeyScope, provider.id, nextValue)
      const maskedKey = result?.maskedKey || maskPiProviderKey(nextValue)
      setProviderKeys((current) => current.map((entry) => (
        entry.id === provider.id
          ? { ...entry, hasKey: true, maskedKey }
          : entry
      )))
      setProviderKeyDrafts((current) => ({ ...current, [provider.id]: '' }))
      updateProviderKeyMessage(`${provider.label} API key saved`, 'success')
    } catch {
      updateProviderKeyMessage(`Failed to save ${provider.label} API key`, 'error')
    } finally {
      setProviderKeyPending((current) => ({ ...current, [provider.id]: '' }))
    }
  }

  const handleProviderKeyRemove = async (provider) => {
    setProviderKeyPending((current) => ({ ...current, [provider.id]: 'removing' }))
    updateProviderKeyMessage('')
    try {
      await removePiProviderKey(providerKeyScope, provider.id)
      setProviderKeys((current) => current.map((entry) => (
        entry.id === provider.id
          ? { ...entry, hasKey: false, maskedKey: '' }
          : entry
      )))
      setProviderKeyDrafts((current) => ({ ...current, [provider.id]: '' }))
      updateProviderKeyMessage(`${provider.label} API key removed`, 'success')
    } catch {
      updateProviderKeyMessage(`Failed to remove ${provider.label} API key`, 'error')
    } finally {
      setProviderKeyPending((current) => ({ ...current, [provider.id]: '' }))
    }
  }

  const handleLogout = () => {
    const route = routes.controlPlane.auth.logout()
    window.location.assign(routeHref(route))
  }

  if (loading) {
    return (
      <PageShell title="User Settings" backHref={backHref}>
        <div className="page-loading">
          <Loader2 className="page-loading-icon" size={32} />
          <span>Loading settings...</span>
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell title="User Settings" backHref={backHref}>
        <div className="page-error">{error}</div>
      </PageShell>
    )
  }

  const isAuthenticated = Boolean(email)

  return (
    <PageShell title="User Settings" backHref={backHref}>
      <div className="settings-card">
        <SettingsSection
          title="Agent API Keys"
          icon={KeyRound}
          description="Stored locally in this browser profile for the built-in agent. These keys do not sync across devices."
        >
          {providerKeys.map((provider) => {
            const pendingState = providerKeyPending[provider.id] || ''
            const isBusy = Boolean(pendingState)
            return (
              <SettingsField
                key={provider.id}
                label={provider.label}
                description={provider.description}
              >
                <div className="settings-provider-key">
                  <div className="settings-provider-key-status">
                    {provider.hasKey
                      ? `Saved locally as ${provider.maskedKey}`
                      : 'No key saved yet'}
                  </div>
                  <input
                    type="password"
                    className="settings-input settings-input-mono"
                    value={providerKeyDrafts[provider.id] || ''}
                    onChange={(e) => handleProviderKeyDraftChange(provider.id, e.target.value)}
                    placeholder={
                      provider.hasKey
                        ? `Paste a new ${provider.label} key to replace the saved one`
                        : `Paste your ${provider.label} API key`
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="settings-btn settings-btn-primary"
                      onClick={() => handleProviderKeySave(provider)}
                      disabled={isBusy || !String(providerKeyDrafts[provider.id] || '').trim()}
                    >
                      {pendingState === 'saving' ? 'Saving...' : 'Save Key'}
                    </button>
                    <button
                      type="button"
                      className="settings-btn settings-btn-secondary"
                      onClick={() => handleProviderKeyRemove(provider)}
                      disabled={isBusy || !provider.hasKey}
                    >
                      {pendingState === 'removing' ? 'Removing...' : 'Remove Key'}
                    </button>
                  </div>
                </div>
              </SettingsField>
            )
          })}
          <p className="settings-provider-key-note">
            If Anthropic still reports low credit after you top up or rotate the key, replace or remove the saved key here before starting another agent chat.
          </p>
          {providerKeyMessage && (
            <span className={`settings-save-message ${providerKeyMessageTone}`}>
              {providerKeyMessage}
            </span>
          )}
        </SettingsSection>

        {isAuthenticated && (
          <SettingsSection title="Profile" icon={User}>
            <SettingsField label="Email" description="Your account email address">
              <input
                type="email"
                className="settings-input"
                value={email}
                disabled
              />
            </SettingsField>
            <SettingsField label="Display Name">
              <input
                type="text"
                className="settings-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter display name"
              />
            </SettingsField>
            <div className="settings-actions">
              <button
                type="button"
                className="settings-btn settings-btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              {profileSaveMessage && (
                <span className={`settings-save-message ${profileSaveMessageTone}`}>
                  {profileSaveMessage}
                </span>
              )}
            </div>
          </SettingsSection>
        )}

        <SettingsSection title="Appearance" icon={Palette}>
          <SettingsField label="Theme" description="Choose light or dark mode">
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              onClick={toggleTheme}
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
          </SettingsField>
        </SettingsSection>

        {isAuthenticated && (
          <SettingsSection title="Account" icon={Shield} danger>
            <SettingsField label="Sign Out" description="Sign out of your account">
              <button
                type="button"
                className="settings-btn settings-btn-danger"
                onClick={handleLogout}
              >
                Sign Out
              </button>
            </SettingsField>
          </SettingsSection>
        )}
      </div>
    </PageShell>
  )
}
