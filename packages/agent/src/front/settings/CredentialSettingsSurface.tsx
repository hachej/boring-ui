import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Button,
  Input,
  Label,
  Notice,
  SettingsPanel,
} from '@hachej/boring-ui-kit'
import { ExternalLink, KeyRound } from 'lucide-react'
import type { CredentialMetadataV1 } from '../../shared/credentials'
import {
  createCredentialSettingsClient,
  type CredentialFundingMethod,
  type CredentialOAuthFlow,
  type CredentialSettingsClient,
} from './credentialSettingsClient'

export interface CredentialSettingsSurfaceProps {
  /** The host must derive this from its authenticated workspace membership. */
  isWorkspaceOwner: boolean
  /** Active workspace scope sent to the authenticated credential routes. */
  workspaceId?: string
  apiBaseUrl?: string
  /** Test/host transport seam. It must preserve the metadata-only contract. */
  client?: CredentialSettingsClient
}

function statusLabel(credential: CredentialMetadataV1): string {
  const labels: Record<string, string> = {
    active: 'Connected',
    disabled: 'Disabled',
    revoked: 'Revoked',
    needs_reauth: 'Sign-in required',
    intentionally_absent: 'Deleted',
    instance_fallback_enabled: 'Instance fallback',
    not_configured: 'Not connected',
  }
  return labels[credential.state] ?? 'Unavailable'
}

function updatedLabel(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()
}

export function CredentialSettingsSurface({
  isWorkspaceOwner,
  workspaceId,
  apiBaseUrl = '',
  client: suppliedClient,
}: CredentialSettingsSurfaceProps) {
  const client = useMemo(
    () => suppliedClient ?? createCredentialSettingsClient(
      apiBaseUrl,
      fetch,
      workspaceId ? { 'x-boring-workspace-id': workspaceId } : undefined,
    ),
    [apiBaseUrl, suppliedClient, workspaceId],
  )
  const [credentials, setCredentials] = useState<readonly CredentialMetadataV1[]>([])
  const [loading, setLoading] = useState(true)
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [fundingMethods, setFundingMethods] = useState<Record<string, CredentialFundingMethod>>({})
  const [oauthFlow, setOauthFlow] = useState<CredentialOAuthFlow | null>(null)
  const oauthRequestEpoch = useRef(0)

  const load = useCallback(async () => {
    setError(null)
    try {
      setCredentials(await client.list())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load workspace credentials.')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    if (!isWorkspaceOwner) return
    void load()
  }, [isWorkspaceOwner, load])

  useEffect(() => {
    if (!oauthFlow || oauthFlow.status !== 'pending') return
    const epoch = ++oauthRequestEpoch.current
    const timer = window.setTimeout(() => {
      void client.getCodexLogin(oauthFlow.flowId).then((flow) => {
        if (oauthRequestEpoch.current !== epoch) return
        setOauthFlow(flow)
        if (flow.status === 'succeeded') {
          setSuccess('OpenAI Codex is connected for this workspace. New sessions can use it.')
          void load()
        } else if (flow.status === 'failed') {
          setError('OpenAI Codex sign-in did not complete. Try again.')
        }
      }).catch(() => {
        if (oauthRequestEpoch.current === epoch) setError('Could not refresh OpenAI Codex sign-in.')
      })
    }, 750)
    return () => {
      window.clearTimeout(timer)
      if (oauthRequestEpoch.current === epoch) oauthRequestEpoch.current += 1
    }
  }, [client, load, oauthFlow])

  if (!isWorkspaceOwner) return null

  const updateCredential = (next: CredentialMetadataV1) => {
    setCredentials((current) => current.map((item) => item.providerId === next.providerId ? next : item))
  }

  const submitApiKey = async (event: FormEvent<HTMLFormElement>, credential: CredentialMetadataV1) => {
    event.preventDefault()
    if (credential.providerId === 'openai-codex' && oauthFlow?.status === 'pending') return
    const form = event.currentTarget
    const apiKey = String(new FormData(form).get('api-key') ?? '')
    form.reset()
    if (!apiKey) {
      setError('Enter an API key before saving.')
      return
    }
    setError(null)
    setSuccess(null)
    setBusyProvider(credential.providerId)
    try {
      updateCredential(await client.putApiKey(credential.providerId, apiKey))
      setSuccess(`${credential.displayName} API key saved. New sessions use this workspace credential.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the API key.')
    } finally {
      setBusyProvider(null)
    }
  }

  const lifecycle = async (
    credential: CredentialMetadataV1,
    action: 'disable' | 'revoke' | 'delete',
  ) => {
    if (credential.providerId === 'openai-codex' && oauthFlow?.status === 'pending') return
    setError(null)
    setSuccess(null)
    setBusyProvider(credential.providerId)
    try {
      updateCredential(await client[action](credential.providerId))
      setSuccess(`${credential.displayName} ${action === 'delete' ? 'deleted' : `${action}d`}.`)
      setConfirmDelete(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Credential operation failed.')
    } finally {
      setBusyProvider(null)
    }
  }

  const startCodex = async () => {
    oauthRequestEpoch.current += 1
    setError(null)
    setSuccess(null)
    setBusyProvider('openai-codex')
    try {
      setOauthFlow(await client.startCodexLogin())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start OpenAI Codex sign-in.')
    } finally {
      setBusyProvider(null)
    }
  }

  const respondToPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!oauthFlow) return
    const form = event.currentTarget
    const value = String(new FormData(form).get('oauth-response') ?? '')
    form.reset()
    if (!value) return
    try {
      setOauthFlow(await client.respondToCodexLogin(oauthFlow.flowId, value))
    } catch {
      setError('OpenAI Codex could not accept that response. Try again.')
    }
  }

  const cancelCodex = async () => {
    if (!oauthFlow) return
    oauthRequestEpoch.current += 1
    setBusyProvider('openai-codex')
    try {
      await client.cancelCodexLogin(oauthFlow.flowId)
      setOauthFlow(null)
    } catch {
      setError('Could not cancel OpenAI Codex sign-in. The flow is still pending.')
      // Re-arm polling after invalidating any request that raced cancellation.
      setOauthFlow((flow) => flow ? { ...flow } : flow)
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <SettingsPanel
      id="credentials"
      icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
      title="AI provider credentials"
      description="Choose how this workspace funds AI sessions. Keys and tokens are write-only and are never shown again."
    >
      <div className="space-y-4">
        {error && <Notice role="alert" tone="error" description={error} />}
        {success && <Notice role="status" tone="success" description={success} />}
        {loading && <p className="text-[13px] text-muted-foreground">Loading providers…</p>}
        {!loading && credentials.length === 0 && !error && (
          <p className="text-[13px] text-muted-foreground">No credential providers are available in this deployment.</p>
        )}
        <div className="divide-y divide-border/50 rounded-md border border-border/60">
          {credentials.map((credential) => {
            const connected = credential.state === 'active'
            const busy = busyProvider === credential.providerId
            const isCodex = credential.providerId === 'openai-codex'
            const codexPending = isCodex && oauthFlow?.status === 'pending'
            const method = fundingMethods[credential.providerId]
              ?? (isCodex && credential.credentialType === 'oauth' ? 'openai-codex' : 'api-key')
            return (
              <section key={credential.providerId} aria-labelledby={`credential-${credential.providerId}`} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 id={`credential-${credential.providerId}`} className="text-[13px] font-medium text-foreground">{credential.displayName}</h3>
                    <p className="text-[12px] text-muted-foreground">
                      {statusLabel(credential)}
                      {credential.maskedLastFourSuffix ? ` · ends in ${credential.maskedLastFourSuffix}` : ''}
                      {credential.credentialVersion ? ` · v${credential.credentialVersion}` : ''}
                    </p>
                    {updatedLabel(credential.updatedAt) && <p className="text-[11px] text-muted-foreground">Updated {updatedLabel(credential.updatedAt)}</p>}
                  </div>
                  {connected && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Workspace funded</span>}
                </div>

                {isCodex && (
                  <fieldset className="space-y-1.5">
                    <legend className="text-[12px] font-medium text-foreground">Workspace funding method</legend>
                    <div className="flex flex-wrap gap-3 text-[12px]">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`funding-${credential.providerId}`} checked={method === 'api-key'} disabled={codexPending} onChange={() => setFundingMethods((value) => ({ ...value, [credential.providerId]: 'api-key' }))} />
                        API key
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`funding-${credential.providerId}`} checked={method === 'openai-codex'} disabled={codexPending} onChange={() => setFundingMethods((value) => ({ ...value, [credential.providerId]: 'openai-codex' }))} />
                        OpenAI Codex sign-in
                      </label>
                    </div>
                  </fieldset>
                )}

                {(!isCodex || method === 'api-key') ? (
                  <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => void submitApiKey(event, credential)}>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor={`api-key-${credential.providerId}`} className="text-[12px]">API key</Label>
                      <Input id={`api-key-${credential.providerId}`} name="api-key" type="password" autoComplete="new-password" className="h-8 text-[13px]" placeholder={connected ? 'Enter a replacement key' : 'Paste API key'} />
                    </div>
                    <Button type="submit" size="sm" disabled={busy || codexPending}>{busy ? 'Saving…' : connected ? 'Replace key' : 'Connect'}</Button>
                  </form>
                ) : (
                  <div>
                    <Button type="button" size="sm" onClick={() => void startCodex()} disabled={busy || codexPending}>
                      {oauthFlow?.status === 'pending' ? 'Sign-in pending…' : connected ? 'Sign in again' : 'Sign in with OpenAI Codex'}
                    </Button>
                  </div>
                )}

                {isCodex && oauthFlow && (
                  <div className="space-y-3 rounded-md bg-muted/40 p-3" aria-live="polite">
                    <p className="text-[12px] font-medium">OpenAI Codex sign-in: {oauthFlow.status}</p>
                    {oauthFlow.events.map((event, index) => event.type === 'auth_url' ? (
                      <a key={`${event.type}-${index}`} href={event.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] underline">Open authorization page <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                    ) : event.type === 'device_code' ? (
                      <div key={`${event.type}-${index}`} className="text-[12px]">
                        <p>Enter code <strong className="font-mono">{event.userCode}</strong></p>
                        <a href={event.verificationUri} target="_blank" rel="noreferrer" className="underline">Open device verification</a>
                      </div>
                    ) : null)}
                    {oauthFlow.prompt?.options ? (
                      <div className="flex flex-wrap gap-2">
                        {oauthFlow.prompt.options.map((option) => <Button key={option.id} type="button" size="sm" variant="outline" onClick={() => void client.respondToCodexLogin(oauthFlow.flowId, option.id).then(setOauthFlow)}>{option.label}</Button>)}
                      </div>
                    ) : oauthFlow.prompt ? (
                      <form onSubmit={(event) => void respondToPrompt(event)} className="flex gap-2">
                        <Label htmlFor="oauth-response" className="sr-only">Authorization response</Label>
                        <Input id="oauth-response" name="oauth-response" type={oauthFlow.prompt.type === 'password' ? 'password' : 'text'} autoComplete="off" className="h-8 text-[13px]" placeholder="Paste the authorization response" />
                        <Button type="submit" size="sm">Continue</Button>
                      </form>
                    ) : null}
                    {oauthFlow.status === 'pending' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void cancelCodex()}>Cancel sign-in</Button>}
                  </div>
                )}

                {credential.state !== 'not_configured' && credential.state !== 'intentionally_absent' && (
                  <div className="flex flex-wrap gap-2 border-t border-border/40 pt-3">
                    <Button type="button" size="sm" variant="outline" disabled={busy || codexPending || credential.state === 'disabled'} onClick={() => void lifecycle(credential, 'disable')}>Disable</Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy || codexPending || credential.state === 'revoked'} onClick={() => void lifecycle(credential, 'revoke')}>Revoke</Button>
                    {confirmDelete === credential.providerId ? (
                      <>
                        <Button type="button" size="sm" variant="destructive" disabled={busy || codexPending} onClick={() => void lifecycle(credential, 'delete')}>Confirm delete</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      </>
                    ) : (
                      <Button type="button" size="sm" variant="destructive" disabled={busy || codexPending} onClick={() => setConfirmDelete(credential.providerId)}>Delete</Button>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
        <p className="text-[12px] leading-5 text-muted-foreground">Changes apply to new sessions. Existing sessions keep the credential they started with.</p>
      </div>
    </SettingsPanel>
  )
}
