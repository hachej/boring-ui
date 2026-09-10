import { describe, expect, test, vi } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import { InMemoryShareEntryStore } from '../../../shared/share-entry'
import type { Workspace } from '../../../shared/workspace'
import type { ChannelBinding } from '../channelBindingStore'
import {
  ChannelArtifactDeliveryService,
  createHeadlessChromiumPdfRenderer,
} from '../channelArtifactDeliveryService'

const binding: ChannelBinding = {
  channel: 'whatsapp',
  conversationKey: '41790000000',
  agentTypeId: 'default',
  workspaceId: 'workspace-1',
  authSubjectId: 'user-1',
  bindingVersion: 1,
  status: 'active',
  sessionKey: 'session-1',
  outboundCursor: '-1',
  outboundStatus: 'active',
  sessionResetPending: false,
}

function mutableWorkspace(initial: string) {
  let content = initial
  let mtimeMs = 1
  const workspace = {
    root: '/private/workspace-1',
    runtimeContext: { runtimeCwd: '/private/workspace-1' },
    readFile: vi.fn(async (_path: string) => content),
    writeFile: vi.fn(async (_path: string, value: string) => { content = value; mtimeMs += 1 }),
    unlink: vi.fn(), readdir: vi.fn(async () => []), mkdir: vi.fn(), rename: vi.fn(),
    stat: vi.fn(async () => ({
      kind: 'file' as const,
      size: new TextEncoder().encode(content).byteLength,
      mtimeMs,
    })),
  } satisfies Workspace
  return { workspace, edit: (value: string) => { content = value; mtimeMs += 1 } }
}

const pdf = (label: string) => new TextEncoder().encode(`%PDF-${label}`)

describe('ChannelArtifactDeliveryService', () => {
  test('publishes a bound-workspace authenticated link and sends an immutable PDF snapshot', async () => {
    const source = mutableWorkspace('<html>version one</html>')
    const store = new InMemoryShareEntryStore()
    let renderedHtml = ''
    let delivered = new Uint8Array()
    const sender = {
      sendDocument: vi.fn(async (input: { bytes: Uint8Array }) => { delivered = Uint8Array.from(input.bytes) }),
      sendArtifactLink: vi.fn(async () => undefined),
    }
    const service = new ChannelArtifactDeliveryService(
      store,
      { resolveWorkspace: vi.fn(async (candidate) => {
        if (candidate.workspaceId !== 'workspace-1' || candidate.authSubjectId !== 'user-1') throw new Error('denied')
        return source.workspace
      }) },
      { render: vi.fn(async (html) => { renderedHtml = html; return pdf(html) }) },
      sender,
      { authenticatedOrigin: 'https://app.example.test', producerPrincipalRef: 'agent:default' },
    )

    const published = await service.publish({ binding, artifactPath: 'private/quotes/acme.html' })
    source.edit('<html>version two</html>')

    expect(renderedHtml).toBe('<html>version one</html>')
    expect(new TextDecoder().decode(delivered)).toBe('%PDF-<html>version one</html>')
    expect(published).toMatchObject({ filename: 'artifact.pdf', pdfByteSize: delivered.byteLength })
    expect(published.url).toBe(`https://app.example.test/a/${encodeURIComponent(published.shareId)}`)
    expect(published.url).not.toMatch(/private|quotes|acme|user-1|workspace-1|token|secret|[?#]/)
    expect(sender.sendDocument).toHaveBeenCalledWith(expect.objectContaining({
      conversationKey: binding.conversationKey,
      filename: 'artifact.pdf',
      mimeType: 'application/pdf',
    }))
    expect(sender.sendArtifactLink).toHaveBeenCalledWith({ conversationKey: binding.conversationKey, url: published.url })

    const entry = await store.get(published.shareId)
    expect(entry).toMatchObject({ workspaceId: 'workspace-1', path: 'private/quotes/acme.html' })
    expect(await source.workspace.readFile(entry!.path)).toContain('version two')
  })

  test('fails closed before reading or publishing for revoked bindings and non-HTML targets', async () => {
    const source = mutableWorkspace('<html>secret</html>')
    const store = new InMemoryShareEntryStore()
    const sender = { sendDocument: vi.fn(), sendArtifactLink: vi.fn() }
    const service = new ChannelArtifactDeliveryService(
      store,
      { resolveWorkspace: vi.fn(async () => source.workspace) },
      { render: vi.fn(async () => pdf('ok')) },
      sender,
      { authenticatedOrigin: 'https://app.example.test' },
    )

    await expect(service.publish({ binding: { ...binding, status: 'revoked' }, artifactPath: 'private/a.html' }))
      .rejects.toMatchObject({ code: ErrorCode.enum.UNAUTHORIZED, retryable: false })
    await expect(service.publish({ binding, artifactPath: 'private/a.pdf' }))
      .rejects.toMatchObject({ code: ErrorCode.enum.UNAUTHORIZED, retryable: false })
    expect(source.workspace.readFile).not.toHaveBeenCalled()
    expect(await store.list(binding.workspaceId)).toEqual([])
    expect(sender.sendDocument).not.toHaveBeenCalled()
  })

  test('rejects secret-bearing or unauthenticated origins', () => {
    const source = mutableWorkspace('<html>ok</html>')
    const deps = [new InMemoryShareEntryStore(), { resolveWorkspace: async () => source.workspace }, { render: async () => pdf('ok') }, { sendDocument: async () => undefined, sendArtifactLink: async () => undefined }] as const
    for (const origin of ['http://app.example.test', 'https://user:secret@app.example.test', 'https://app.example.test/?token=secret']) {
      expect(() => new ChannelArtifactDeliveryService(...deps, { authenticatedOrigin: origin })).toThrow(/origin is invalid/)
    }
  })

  test('retries transient provider failures without re-reading or re-rendering the snapshot', async () => {
    const source = mutableWorkspace('<html>stable</html>')
    const render = vi.fn(async () => pdf('stable'))
    const sendDocument = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('throttled'), { retryable: true }))
      .mockResolvedValue(undefined)
    const service = new ChannelArtifactDeliveryService(
      new InMemoryShareEntryStore(),
      { resolveWorkspace: async () => source.workspace },
      { render },
      { sendDocument, sendArtifactLink: async () => undefined },
      { authenticatedOrigin: 'https://app.example.test', retryDelayMs: 1 },
    )

    await service.publish({ binding, artifactPath: 'quote.html' })

    expect(sendDocument).toHaveBeenCalledTimes(2)
    expect(source.workspace.readFile).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledOnce()
  })

  test('renders through a headless Chromium lifecycle', async () => {
    const close = vi.fn(async () => undefined)
    const page = {
      route: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      pdf: vi.fn(async () => pdf('chromium')),
    }
    const newPage = vi.fn(async () => page)
    const launch = vi.fn(async () => ({ newPage, close }))
    const renderer = createHeadlessChromiumPdfRenderer({ launch })

    await expect(renderer.render('<html>quote</html>')).resolves.toEqual(pdf('chromium'))
    expect(launch).toHaveBeenCalledWith({
      headless: true,
      args: expect.arrayContaining(['--disable-webrtc', '--host-resolver-rules=MAP * ~NOTFOUND']),
    })
    expect(newPage).toHaveBeenCalledWith({ javaScriptEnabled: false, offline: true, serviceWorkers: 'block' })
    expect(page.route).toHaveBeenCalledWith('**/*', expect.any(Function))
    expect(page.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function))
    expect(page.setContent).toHaveBeenCalledWith('<html>quote</html>', { waitUntil: 'load' })
    expect(page.pdf).toHaveBeenCalledWith({ format: 'A4', printBackground: true })
    expect(close).toHaveBeenCalledOnce()
  })
})
