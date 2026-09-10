import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTempWorkspace, type TempWorkspaceHandle } from '../../../__tests__/helpers/createTempWorkspace'
import { openDatabase } from '../../events/sqlStorage'
import { ChannelBindingStore, type QueuedChannelInbound } from '../channelBindingStore'
import { ChannelInboundMediaError, ChannelInboundMediaService } from '../channelInboundMediaService'
import { ChannelInboundService, type ChannelAgentInvoker } from '../channelInboundService'

const opened: TempWorkspaceHandle[] = []
afterEach(async () => { await Promise.all(opened.splice(0).map((item) => item.cleanup())) })

const binding = {
  channel: 'whatsapp', conversationKey: '4179', agentTypeId: 'default', workspaceId: 'workspace-1',
  authSubjectId: 'member-1', bindingVersion: 1, status: 'active', outboundCursor: '-1',
  outboundStatus: 'active', sessionResetPending: false,
} as const

function queued(kind: 'image' | 'audio' | 'document', id = 'wamid.1'): QueuedChannelInbound {
  return {
    ...binding, id: 1, providerMessageId: id, text: kind === 'image' ? 'What is this?' : '', receivedAt: 1,
    claimOwner: 'worker', attempts: 1, status: 'processing', media: {
      kind, mediaId: `media-${id}`, ...(kind === 'document' ? { declaredMimeType: 'application/pdf' } : {}),
    },
  }
}

async function workspace() {
  const handle = await createTempWorkspace('channel-media-')
  opened.push(handle)
  return handle.workspace
}

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])
const ogg = new Uint8Array([79, 103, 103, 83, 1, 2, 3])

describe('ChannelInboundMediaService', () => {
  test('retains a validated photo in the bound Workspace and produces the supported image attachment', async () => {
    const target = await workspace()
    const download = vi.fn(async () => ({ bytes: png, mimeType: 'image/png' }))
    const transcribeFile = vi.fn()
    const service = new ChannelInboundMediaService(
      { storageRegion: 'CH', resolveWorkspace: async (candidate) => { expect(candidate.workspaceId).toBe('workspace-1'); return target } },
      new Map([['whatsapp', { download }]]),
      { processorRegion: 'CH', transcribeFile },
    )
    const prepared = await service.prepare(binding, queued('image'))
    expect(prepared).toMatchObject({ text: 'What is this?', requireIdle: true, attachments: [{ mediaType: 'image/png' }] })
    const attachment = prepared.attachments![0]!
    expect(attachment.path).toMatch(/^channel-media\/[a-f0-9]{64}\.png$/)
    await expect(target.readBinaryFile!(attachment.path!)).resolves.toEqual(png)
    expect(transcribeFile).not.toHaveBeenCalled()
  })

  test('retains original voice bytes, caches transcript text, and never calls a mismatched-region processor', async () => {
    const target = await workspace()
    const download = vi.fn(async () => ({ bytes: ogg, mimeType: 'audio/ogg' }))
    const transcribeFile = vi.fn(async () => ({ text: 'Please prepare the quote.' }))
    const service = new ChannelInboundMediaService(
      { storageRegion: 'EU', resolveWorkspace: async () => target }, new Map([['whatsapp', { download }]]),
      { processorRegion: 'EU', transcribeFile },
    )
    await expect(service.prepare(binding, queued('audio'))).resolves.toMatchObject({
      text: expect.stringContaining('Please prepare the quote.'),
    })
    await service.prepare(binding, queued('audio'))
    expect(download).toHaveBeenCalledTimes(1)
    expect(transcribeFile).toHaveBeenCalledTimes(1)
    const retained = await target.readdir('channel-media')
    expect(retained).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.stringMatching(/\.ogg$/) }),
      expect.objectContaining({ name: expect.stringMatching(/\.txt$/) }),
    ]))
    const transcript = retained.find((entry) => entry.name.endsWith('.txt'))!
    await target.writeFile(`channel-media/${transcript.name}`, '   ')
    await expect(service.prepare(binding, queued('audio'))).rejects.toMatchObject({ retryable: false })
    expect(() => new ChannelInboundMediaService(
      { storageRegion: 'CH', resolveWorkspace: async () => target }, new Map(),
      { processorRegion: 'EU', transcribeFile },
    )).toThrow(ChannelInboundMediaError)
  })

  test('answers unsupported PDFs honestly without downloading bytes', async () => {
    const target = await workspace()
    const download = vi.fn()
    const service = new ChannelInboundMediaService(
      { storageRegion: 'CH', resolveWorkspace: async () => target }, new Map([['whatsapp', { download }]]),
      { processorRegion: 'CH', transcribeFile: vi.fn() },
    )
    await expect(service.prepare(binding, queued('document'))).resolves.toEqual({
      text: 'The sender attached a PDF. PDFs are not supported on WhatsApp yet; ask them to send text, a photo, or a voice note instead.',
    })
    expect(download).not.toHaveBeenCalled()
  })

  test('rejects spoofed content and oversize downloads permanently', async () => {
    const target = await workspace()
    for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array(10)]) {
      const service = new ChannelInboundMediaService(
        { storageRegion: 'CH', resolveWorkspace: async () => target },
        new Map([['whatsapp', { download: async () => ({ bytes, mimeType: 'image/png' }) }]]),
        { processorRegion: 'CH', transcribeFile: vi.fn() }, { maxImageBytes: 8 },
      )
      await expect(service.prepare(binding, queued('image', String(bytes.length))))
        .rejects.toMatchObject({ retryable: false })
    }
  })
})

describe('ChannelInboundService media admission', () => {
  test('fails closed mid-turn because follow-ups cannot carry attachments', async () => {
    const target = await workspace()
    const db = openDatabase(`${target.root}/channel.sqlite`)
    const store = new ChannelBindingStore(db.sql, db.runTransaction)
    store.provision({ ...binding, sessionKey: 'session-1' })
    const prompt = vi.fn()
    const followUp = vi.fn()
    const invoker: ChannelAgentInvoker = {
      createSession: vi.fn(), isSessionBusy: vi.fn(async () => true), prompt, followUp,
    }
    const prepare = vi.fn()
    const inbound = new ChannelInboundService(store, invoker, { media: { prepare } as never })
    inbound.accept({
      channel: 'whatsapp', conversationKey: '4179', providerMessageId: 'busy-photo', text: '', receivedAt: 1,
      media: { kind: 'image', mediaId: 'meta-photo' },
    }, 'default')
    await inbound.waitForIdle()
    expect(prepare).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(followUp).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('could not safely attach media'),
    }))
    expect(followUp.mock.calls[0]![0]).not.toHaveProperty('attachments')
    prepare.mockResolvedValue({ text: 'The sender attached a PDF. PDFs are not supported on WhatsApp yet.' })
    inbound.accept({
      channel: 'whatsapp', conversationKey: '4179', providerMessageId: 'busy-pdf', text: '', receivedAt: 2,
      media: { kind: 'document', mediaId: 'meta-pdf', declaredMimeType: 'application/pdf' },
    }, 'default')
    await inbound.waitForIdle()
    expect(prepare).toHaveBeenCalledOnce()
    expect(followUp).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining('PDFs are not supported') }))
    await inbound.dispose()
    db.db.close()
  })
})
