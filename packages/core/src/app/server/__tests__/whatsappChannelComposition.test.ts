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
import { InMemoryShareEntryStore, type AgentGateway } from '@hachej/boring-agent/shared'
import {
  assertCoreWhatsAppAgentAvailable,
  createCoreWhatsAppWorkspaceRunner,
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

  it('drives signed photo and voice fixtures through authenticated download, regional retention, and model input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'core-whatsapp-media-'))
    roots.push(root)
    const storage = createAgentHostChannelStorage({ sessionRoot: root })
    const app = Fastify()
    const files = new Map<string, Uint8Array | string>()
    const workspace = {
      root, runtimeContext: { runtimeCwd: root },
      mkdir: vi.fn(async () => undefined),
      stat: async (path: string) => { const value = files.get(path); if (value === undefined) throw new Error('ENOENT'); return { kind: 'file' as const, size: typeof value === 'string' ? value.length : value.byteLength, mtimeMs: 1 } },
      readFile: async (path: string) => { const value = files.get(path); if (typeof value !== 'string') throw new Error('ENOENT'); return value },
      writeFile: async (path: string, value: string) => { files.set(path, value) },
      readBinaryFile: async (path: string) => { const value = files.get(path); if (!(value instanceof Uint8Array)) throw new Error('ENOENT'); return value },
      writeBinaryFile: async (path: string, value: Uint8Array) => { files.set(path, value) },
      readdir: vi.fn(), unlink: vi.fn(), rename: vi.fn(),
    }
    files.set('private/quote.html', '<html>runtime workspace quote</html>')
    const stream = await storage.events.createSessionStream(
      { workspaceScopeId: 'workspace-1', sessionId: 'media-session' },
      { agentTypeId: 'default', authSubjectId: 'member-1' },
    )
    const sends: Array<{ content: string; attachments?: readonly unknown[]; requireIdle?: true }> = []
    const gateway = {
      createSession: vi.fn(async () => ({ agentTypeId: 'default', sessionId: 'media-session' })),
      readSessionState: vi.fn(async () => ({ summary: { status: 'idle' } })),
      connectSession: vi.fn(async () => ({
        events: (async function* () {})(), close: async () => undefined,
        send: async (command: { content: string; attachments?: readonly unknown[]; requireIdle?: true }) => { sends.push(command); return { accepted: true } },
      })),
    } as unknown as AgentGateway
    const secret = 'secret-app'
    const withCredentials = async <T>(use: (credentials: { accessToken: string; appSecret: string; verifyToken: string; phoneNumberId: string; fallbackTemplateName: string }) => T | Promise<T>) => use({
      accessToken: 'secret-access', appSecret: secret, verifyToken: 'verify', phoneNumberId: '123', fallbackTemplateName: 'continue',
    })
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const ogg = new Uint8Array([79, 103, 103, 83, 1])
    const deliveredPdfBodies: Uint8Array[] = []
    const graphFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/photo-id')) return Response.json({ url: 'https://lookaside.fbsbx.com/photo', mime_type: 'image/png' })
      if (value.endsWith('/voice-id')) return Response.json({ url: 'https://lookaside.fbsbx.com/voice', mime_type: 'audio/ogg' })
      if (value.endsWith('/photo')) return new Response(png, { headers: { 'content-type': 'image/png' } })
      if (value.endsWith('/voice')) return new Response(ogg, { headers: { 'content-type': 'audio/ogg' } })
      if (value.endsWith('/media') && init?.body instanceof FormData) {
        const file = init.body.get('file')
        if (file instanceof Blob) deliveredPdfBodies.push(new Uint8Array(await file.arrayBuffer()))
        return Response.json({ id: 'pdf-media-id' })
      }
      return Response.json({ messages: [{ id: 'sent' }] })
    })
    const transcribeFile = vi.fn(async () => ({ text: 'Book the meeting tomorrow.' }))
    const render = vi.fn(async (html: string) => new TextEncoder().encode(`%PDF-${html}`))
    const authorizedScope = {} as AuthorizedAgentScope
    const resolveAuthorizedScope = vi.fn(async () => authorizedScope)
    const release = vi.fn()
    const acquireEnvironment = vi.fn(async () => ({ workspace, release }))
    const withAuthorizedWorkspace = vi.fn(createCoreWhatsAppWorkspaceRunner({
      agentHost: { acquireEnvironment } as never,
      resolveAuthorizedScope,
    }))
    const mounted = await mountCoreWhatsAppChannel({
      app, gateway, storage, resolveAuthorizedScope, withAuthorizedWorkspace,
      shareEntryStore: new InMemoryShareEntryStore(),
      options: {
        withCredentials, graphFetch, agentTypeId: 'default',
        provisionedBindings: [{ conversationKey: '4179', workspaceId: 'workspace-1', authSubjectId: 'member-1' }],
        inboundMedia: {
          storageRegion: 'CH',
          transcriber: { processorRegion: 'CH', transcribeFile },
        },
        artifactDelivery: {
          authenticatedOrigin: 'https://app.example.test',
          renderer: { render },
        }
      },
    })
    const post = async (message: unknown) => {
      const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [message] } }] }] })
      const response = await app.inject({ method: 'POST', url: mounted.webhookPath, headers: {
        'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`,
      }, payload })
      expect(response.statusCode).toBe(200)
      await mounted.runtime.waitForIdle()
    }
    await post({ id: 'photo-message', from: '4179', type: 'image', image: { id: 'photo-id', mime_type: 'image/png', caption: 'What is shown?' } })
    await storage.events.appendAgentEvent(stream, { type: 'agent-start', seq: 1, turnId: 'turn-artifact' })
    await storage.events.appendAgentEvent(stream, {
      type: 'message-end', seq: 2, messageId: 'artifact-assistant',
      final: {
        id: 'artifact-assistant', role: 'assistant', turnId: 'turn-artifact',
        parts: [
          { type: 'text', text: 'Here is the quote.' },
          { type: 'file', path: 'private/quote.html', filename: 'quote.html', mediaType: 'text/html' },
        ],
      },
    })
    await storage.events.appendAgentEvent(stream, { type: 'agent-end', seq: 3, turnId: 'turn-artifact', status: 'ok' })
    await mounted.runtime.waitForIdle()
    await post({ id: 'voice-message', from: '4179', type: 'audio', audio: { id: 'voice-id', mime_type: 'audio/ogg', voice: true } })
    await post({ id: 'pdf-message', from: '4179', type: 'document', document: { id: 'pdf-id', mime_type: 'application/pdf', filename: 'invoice.pdf' } })
    expect(sends[0]).toMatchObject({ content: 'What is shown?', requireIdle: true, attachments: [{ mediaType: 'image/png', path: expect.stringMatching(/\.png$/) }] })
    expect(sends[1]!.content).toContain('Book the meeting tomorrow.')
    expect(sends[2]!.content).toContain('PDFs are not supported on WhatsApp yet')
    expect(graphFetch).not.toHaveBeenCalledWith(expect.stringContaining('pdf-id'), expect.anything())
    expect([...files.keys()]).toEqual(expect.arrayContaining([expect.stringMatching(/\.png$/), expect.stringMatching(/\.ogg$/), expect.stringMatching(/\.txt$/)]))
    expect(transcribeFile).toHaveBeenCalledWith({ bytes: ogg, mimeType: 'audio/ogg' })
    expect(render).toHaveBeenCalledWith('<html>runtime workspace quote</html>')
    expect(new TextDecoder().decode(deliveredPdfBodies[0])).toContain('runtime workspace quote')
    expect(graphFetch.mock.calls.every(([, init]) => (init as RequestInit).headers && JSON.stringify((init as RequestInit).headers).includes('secret-access'))).toBe(true)
    expect(withAuthorizedWorkspace.mock.invocationCallOrder[0]).toBeLessThan(graphFetch.mock.invocationCallOrder[0]!)
    expect(acquireEnvironment).toHaveBeenCalledWith({
      authorizedScope,
      intent: { kind: 'dispatcher', requestId: 'channel-workspace:default:workspace-1' },
    })
    expect(release).toHaveBeenCalledTimes(acquireEnvironment.mock.calls.length)
    await mounted.close(); await app.close(); storage.close()
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
      withAuthorizedWorkspace: async () => { throw new Error('not used') },
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
    const initialBinding = mounted.runtime.bindings.getBinding('whatsapp', '+41790000000', 'default')
    expect(initialBinding).toMatchObject({
      workspaceId: 'workspace-1',
      authSubjectId: 'user-1',
    })
    expect(initialBinding?.sessionKey).toBeUndefined()
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
    storage.bindings.provision({
      channel: 'whatsapp',
      conversationKey: '+41790000002',
      agentTypeId: 'default',
      workspaceId: 'workspace-1',
      authSubjectId: 'user-1',
    })

    const restartedApp = Fastify()
    const restarted = await mountCoreWhatsAppChannel({
      app: restartedApp,
      gateway,
      storage,
      resolveAuthorizedScope: vi.fn(async () => ({}) as AuthorizedAgentScope),
      withAuthorizedWorkspace: async () => { throw new Error('not used') },
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
    const restartedBinding = restarted.runtime.bindings.getBinding('whatsapp', '+41790000000', 'default')
    // The mocked gateway has no durable stream, so the runtime may clear its
    // unusable session asynchronously; startup provisioning must not bump generation.
    expect(restartedBinding?.bindingVersion).toBe(assigned.bindingVersion)
    expect(restarted.runtime.bindings.getBinding('whatsapp', '+41790000002', 'default')?.status).toBe('revoked')
    await restarted.close()
    await restartedApp.close()
    storage.close()
  })
})
