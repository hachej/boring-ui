import { describe, expect, it, vi } from 'vitest'
import { readFullAppWhatsAppChannelOptions } from '../whatsapp.js'

const enabledEnv = {
  BORING_AGENT_CHANNELS: '1',
  BORING_WHATSAPP_ACCESS_TOKEN: 'access',
  BORING_WHATSAPP_APP_SECRET: 'app-secret',
  BORING_WHATSAPP_VERIFY_TOKEN: 'verify',
  BORING_WHATSAPP_PHONE_NUMBER_ID: '123456',
  BORING_WHATSAPP_FALLBACK_TEMPLATE: 'continue_update',
  BORING_WHATSAPP_BINDINGS_JSON: JSON.stringify([{
    conversationKey: '+41790000000',
    workspaceId: 'workspace-1',
    authSubjectId: 'user-1',
  }]),
}

describe('readFullAppWhatsAppChannelOptions', () => {
  it('keeps the deployable host disabled unless the shared channel flag is explicit', () => {
    expect(readFullAppWhatsAppChannelOptions('default', {})).toBeUndefined()
    expect(readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv,
      BORING_AGENT_CHANNELS: 'true',
    })).toBeDefined()
  })

  it('builds a provisioned-only credential lease without returning secrets', async () => {
    const options = readFullAppWhatsAppChannelOptions('default', enabledEnv)
    expect(options).toMatchObject({
      agentTypeId: 'default',
      provisionedBindings: [{
        conversationKey: '+41790000000', workspaceId: 'workspace-1', authSubjectId: 'user-1',
      }],
    })
    const use = vi.fn((credentials) => credentials.phoneNumberId)
    await expect(options!.withCredentials(use)).resolves.toBe('123456')
    expect(use).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'access', appSecret: 'app-secret', verifyToken: 'verify',
    }))
  })

  it('composes authenticated artifact delivery through the bound Workspace and host Chromium', async () => {
    const options = readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv,
      BORING_WHATSAPP_ARTIFACTS: '1',
      BORING_AGENT_WORKSPACE_ROOT: '/var/tmp/full-app-workspaces',
      BORING_WHATSAPP_AUTHENTICATED_ORIGIN: 'https://app.example.test',
      BORING_WHATSAPP_CHROMIUM_PATH: '/usr/bin/chromium',
    })
    expect(options?.artifactDelivery).toMatchObject({
      authenticatedOrigin: 'https://app.example.test',
      runtime: { resolveWorkspace: expect.any(Function) },
      renderer: { render: expect.any(Function) },
    })
    await expect(options!.artifactDelivery!.runtime.resolveWorkspace({ workspaceId: 'workspace-1' } as never))
      .resolves.toMatchObject({ root: '/var/tmp/full-app-workspaces/workspace-1' })
  })

  it('composes bound Workspace retention with a same-region loopback Whisper processor', async () => {
    const options = readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv,
      BORING_WHATSAPP_MEDIA: '1',
      BORING_WHATSAPP_MEDIA_REGION: 'CH',
      BORING_AGENT_WORKSPACE_ROOT: '/var/tmp/full-app-workspaces',
      BORING_WHATSAPP_WHISPER_URL: 'ws://127.0.0.1:9090/asr',
    })
    expect(options?.inboundMedia).toMatchObject({
      runtime: { storageRegion: 'CH' }, transcriber: { processorRegion: 'CH' },
    })
    await expect(options!.inboundMedia!.runtime.resolveWorkspace({ workspaceId: 'workspace-1' } as never))
      .resolves.toMatchObject({ root: '/var/tmp/full-app-workspaces/workspace-1' })
  })

  it('fails boot when enabled without complete credentials, trusted bindings, or local media authority', () => {
    expect(() => readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv,
      BORING_WHATSAPP_APP_SECRET: '',
    })).toThrow(/BORING_WHATSAPP_APP_SECRET/)
    expect(() => readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv,
      BORING_WHATSAPP_BINDINGS_JSON: '[]',
    })).toThrow(/non-empty array/)
    expect(() => readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv, BORING_WHATSAPP_ARTIFACTS: '1',
    })).toThrow(/artifacts require/)
    expect(() => readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv, BORING_WHATSAPP_MEDIA: '1', BORING_WHATSAPP_MEDIA_REGION: 'US',
    })).toThrow(/MEDIA_REGION=CH\|EU/)
    expect(() => readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv, BORING_WHATSAPP_MEDIA: '1', BORING_WHATSAPP_MEDIA_REGION: 'EU',
      BORING_AGENT_WORKSPACE_ROOT: '/data/workspaces', BORING_WHATSAPP_WHISPER_URL: 'wss://api.us.example/asr',
    })).toThrow(/self-hosted loopback/)
  })
})
