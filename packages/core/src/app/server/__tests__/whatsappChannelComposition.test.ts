import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentHostChannelStorage,
  type AuthorizedAgentScope,
} from '@hachej/boring-agent/server'
import type { AgentGateway } from '@hachej/boring-agent/shared'
import {
  assertCoreWhatsAppAgentAvailable,
  mountCoreWhatsAppChannel,
} from '../whatsappChannelComposition.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('mountCoreWhatsAppChannel', () => {
  it('rejects a configured Agent outside the validated host fleet', () => {
    expect(() => assertCoreWhatsAppAgentAvailable({
      withCredentials: async (use) => use({
        accessToken: 'access', appSecret: 'secret', verifyToken: 'verify', phoneNumberId: '1',
        fallbackTemplateName: 'continue',
      }),
      agentTypeId: 'typo',
    }, ['default'])).toThrow(/not in the validated fleet: typo/)
  })

  it('mounts the Meta challenge and provisions only trusted app-owned bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-whatsapp-mount-'))
    roots.push(root)
    const storage = createAgentHostChannelStorage({ sessionRoot: root })
    const app = Fastify()
    const gateway = { createSession: vi.fn() } as unknown as AgentGateway
    const withCredentials = async <T>(use: (credentials: {
      accessToken: string
      appSecret: string
      verifyToken: string
      phoneNumberId: string
      fallbackTemplateName: string
    }) => T | Promise<T>) => use({
      accessToken: 'secret-access',
      appSecret: 'secret-app',
      verifyToken: 'verify-me',
      phoneNumberId: '123456',
      fallbackTemplateName: 'continue_update',
    })

    const mounted = await mountCoreWhatsAppChannel({
      app,
      gateway,
      storage,
      resolveAuthorizedScope: vi.fn(async () => ({}) as AuthorizedAgentScope),
      options: {
        withCredentials,
        agentTypeId: 'default',
        provisionedBindings: [{
          conversationKey: '+41790000000',
          workspaceId: 'workspace-1',
          authSubjectId: 'user-1',
        }],
      },
    })

    const challenge = await app.inject({
      method: 'GET',
      url: `${mounted.webhookPath}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=mounted`,
    })
    expect(challenge.statusCode).toBe(200)
    expect(challenge.body).toBe('mounted')
    expect(mounted.runtime.bindings.getBinding('whatsapp', '+41790000000', 'default')).toMatchObject({
      workspaceId: 'workspace-1',
      authSubjectId: 'user-1',
      sessionKey: undefined,
    })
    expect(mounted.runtime.outboundAdapters.has('whatsapp')).toBe(true)

    const unknownInbound = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages: [{
        id: 'wamid.unknown', from: '+41790000001', type: 'text', text: { body: 'hello' },
      }] } }] }],
    })
    const inbound = await app.inject({
      method: 'POST',
      url: mounted.webhookPath,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret-app').update(unknownInbound).digest('hex')}`,
      },
      payload: unknownInbound,
    })
    expect(inbound.statusCode).toBe(200)
    expect(inbound.json()).toEqual({ accepted: 1 })
    expect(mounted.runtime.bindings.getBinding('whatsapp', '+41790000001', 'default')).toBeUndefined()
    expect(gateway.createSession).not.toHaveBeenCalled()

    await mounted.close()
    await app.close()
    const assigned = storage.bindings.provision({
      channel: 'whatsapp',
      conversationKey: '+41790000000',
      agentTypeId: 'default',
      workspaceId: 'workspace-1',
      authSubjectId: 'user-1',
      sessionKey: 'generated-session',
    })

    const restartedApp = Fastify()
    const restarted = await mountCoreWhatsAppChannel({
      app: restartedApp,
      gateway,
      storage,
      resolveAuthorizedScope: vi.fn(async () => ({}) as AuthorizedAgentScope),
      options: {
        withCredentials,
        agentTypeId: 'default',
        provisionedBindings: [{
          conversationKey: '+41790000000',
          workspaceId: 'workspace-1',
          authSubjectId: 'user-1',
        }],
      },
    })
    expect(restarted.runtime.bindings.getBinding('whatsapp', '+41790000000', 'default')).toMatchObject({
      bindingVersion: assigned.bindingVersion,
      sessionKey: 'generated-session',
    })
    await restarted.close()
    await restartedApp.close()
    storage.close()
  })
})
