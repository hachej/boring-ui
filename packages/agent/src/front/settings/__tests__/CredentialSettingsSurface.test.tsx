// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { CredentialMetadataV1 } from '../../../shared/credentials'
import { CredentialSettingsSurface } from '../CredentialSettingsSurface'
import {
  credentialMetadataFromResponse,
  type CredentialOAuthFlow,
  type CredentialSettingsClient,
} from '../credentialSettingsClient'

const anthropic: CredentialMetadataV1 = {
  providerId: 'anthropic',
  displayName: 'Anthropic',
  credentialType: 'api-key',
  state: 'active',
  credentialVersion: 2,
  maskedLastFourSuffix: '1234',
  updatedAt: '2026-09-04T12:00:00.000Z',
}
const codex: CredentialMetadataV1 = {
  providerId: 'openai-codex',
  displayName: 'OpenAI Codex',
  credentialType: 'api-key',
  state: 'not_configured',
}

function client(overrides: Partial<CredentialSettingsClient> = {}): CredentialSettingsClient {
  const flow: CredentialOAuthFlow = {
    flowId: 'flow-a',
    providerId: 'openai-codex',
    status: 'pending',
    events: [],
  }
  return {
    list: vi.fn(async () => [anthropic, codex]),
    putApiKey: vi.fn(async (providerId) => ({ ...anthropic, providerId, credentialVersion: 3 })),
    disable: vi.fn(async () => ({ ...anthropic, state: 'disabled' as const })),
    revoke: vi.fn(async () => ({ ...anthropic, state: 'revoked' as const })),
    delete: vi.fn(async () => ({ ...anthropic, state: 'intentionally_absent' as const })),
    startCodexLogin: vi.fn(async () => flow),
    getCodexLogin: vi.fn(async () => flow),
    respondToCodexLogin: vi.fn(async () => ({ ...flow, status: 'succeeded' as const })),
    cancelCodexLogin: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('CredentialSettingsSurface', () => {
  test('is invisible to non-owners and does not query credential metadata', () => {
    const api = client()
    const { container } = render(<CredentialSettingsSurface isWorkspaceOwner={false} client={api} />)
    expect(container.innerHTML).toBe('')
    expect(api.list).not.toHaveBeenCalled()
  })

  test('renders registry metadata without accepting secret-shaped response fields', async () => {
    const projected = credentialMetadataFromResponse({
      ...anthropic,
      fields: { 'api-key': 'server-secret-canary' },
      accessToken: 'oauth-token-canary',
      maskedLastFourSuffix: 'too-long-1234',
    })
    expect(projected).toEqual(anthropic)
    expect(JSON.stringify(projected)).not.toContain('server-secret-canary')
    expect(JSON.stringify(projected)).not.toContain('oauth-token-canary')

    render(<CredentialSettingsSurface isWorkspaceOwner client={client({ list: vi.fn(async () => [projected, codex]) })} />)
    expect(await screen.findByRole('heading', { name: 'Anthropic' })).not.toBeNull()
    expect(screen.getByText(/Connected · ends in 1234 · v2/)).not.toBeNull()
    expect(screen.queryByText(/server-secret-canary|oauth-token-canary/)).toBeNull()
  })

  test('submits API keys write-only, clears the input immediately, and supports lifecycle actions', async () => {
    let finishWrite: ((value: CredentialMetadataV1) => void) | undefined
    const putApiKey = vi.fn(() => new Promise<CredentialMetadataV1>((resolve) => { finishWrite = resolve }))
    const disable = vi.fn(async () => ({ ...anthropic, state: 'disabled' as const }))
    const api = client({ putApiKey, disable })
    render(<CredentialSettingsSurface isWorkspaceOwner client={api} />)

    const input = await screen.findByLabelText('API key', { selector: '#api-key-anthropic' })
    fireEvent.change(input, { target: { value: 'sk-secret-canary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace key' }))

    expect(putApiKey).toHaveBeenCalledWith('anthropic', 'sk-secret-canary')
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('sk-secret-canary')).toBeNull()
    finishWrite?.({ ...anthropic, credentialVersion: 3, maskedLastFourSuffix: 'nary' })
    expect(await screen.findByText(/API key saved/)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(disable).toHaveBeenCalledWith('anthropic'))
    expect(await screen.findByText('Disabled · ends in 1234 · v2')).not.toBeNull()
  })

  test('offers workspace funding selection and safe Codex browser/device/prompt states', async () => {
    const pending: CredentialOAuthFlow = {
      flowId: 'flow-codex',
      providerId: 'openai-codex',
      status: 'pending',
      events: [
        { type: 'auth_url', url: 'https://login.example.test/authorize' },
        { type: 'device_code', userCode: 'ABCD-EFGH', verificationUri: 'https://login.example.test/device' },
      ],
      prompt: { type: 'manual_code' },
    }
    const startCodexLogin = vi.fn(async () => pending)
    const respondToCodexLogin = vi.fn(async () => ({ ...pending, prompt: undefined }))
    const api = client({ startCodexLogin, respondToCodexLogin })
    render(<CredentialSettingsSurface isWorkspaceOwner client={api} />)

    await screen.findByRole('heading', { name: 'OpenAI Codex' })
    fireEvent.click(screen.getByRole('radio', { name: 'OpenAI Codex sign-in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with OpenAI Codex' }))

    expect((await screen.findByText('Enter code', { exact: false })).textContent).toContain('ABCD-EFGH')
    expect(screen.getByRole('link', { name: /Open authorization page/ }).getAttribute('href')).toBe('https://login.example.test/authorize')
    expect(screen.getByRole('link', { name: 'Open device verification' }).getAttribute('href')).toBe('https://login.example.test/device')

    const prompt = screen.getByLabelText('Authorization response')
    fireEvent.change(prompt, { target: { value: 'owner-code-canary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(respondToCodexLogin).toHaveBeenCalledWith('flow-codex', 'owner-code-canary')
    expect((prompt as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('owner-code-canary')).toBeNull()
  })

  test('restores OAuth funding from metadata and keeps a failed cancellation visible', async () => {
    const oauthCredential: CredentialMetadataV1 = {
      ...codex,
      credentialType: 'oauth',
      state: 'active',
    }
    const pending: CredentialOAuthFlow = {
      flowId: 'flow-pending',
      providerId: 'openai-codex',
      status: 'pending',
      events: [],
    }
    const cancelCodexLogin = vi.fn(async () => { throw new Error('network') })
    const api = client({
      list: vi.fn(async () => [oauthCredential]),
      startCodexLogin: vi.fn(async () => pending),
      cancelCodexLogin,
    })
    render(<CredentialSettingsSurface isWorkspaceOwner client={api} />)

    const oauthMethod = await screen.findByRole('radio', { name: 'OpenAI Codex sign-in' }) as HTMLInputElement
    expect(oauthMethod.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    await waitFor(() => expect(oauthMethod.disabled).toBe(true))

    const codexSection = screen.getByRole('heading', { name: 'OpenAI Codex' }).closest('section')!
    expect((within(codexSection).getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
    expect(await screen.findByRole('alert')).not.toBeNull()
    expect(screen.getByText('OpenAI Codex sign-in: pending')).not.toBeNull()
    expect(cancelCodexLogin).toHaveBeenCalledWith('flow-pending')
  })

  test('requires confirmation before deleting metadata and credential material', async () => {
    const remove = vi.fn(async () => ({ ...anthropic, state: 'intentionally_absent' as const }))
    const api = client({ delete: remove })
    render(<CredentialSettingsSurface isWorkspaceOwner client={api} />)
    await screen.findByRole('heading', { name: 'Anthropic' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('anthropic'))
    expect((await screen.findAllByText(/Deleted|deleted/)).length).toBeGreaterThan(0)
  })
})
