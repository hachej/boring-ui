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
  it('keeps the deployable host disabled unless the channel flag is explicit', () => {
    expect(readFullAppWhatsAppChannelOptions('default', {})).toBeUndefined()
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

  it('fails boot when enabled without complete credentials or trusted bindings', () => {
    expect(() => readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv,
      BORING_WHATSAPP_APP_SECRET: '',
    })).toThrow(/BORING_WHATSAPP_APP_SECRET/)
    expect(() => readFullAppWhatsAppChannelOptions('default', {
      ...enabledEnv,
      BORING_WHATSAPP_BINDINGS_JSON: '[]',
    })).toThrow(/non-empty array/)
  })
})
