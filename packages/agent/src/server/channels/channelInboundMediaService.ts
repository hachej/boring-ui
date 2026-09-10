import { createHash } from 'node:crypto'
import type { ChatAttachmentPayload } from '../../shared/chat'
import type { Workspace } from '../../shared/workspace'
import { ErrorCode } from '../../shared/error-codes'
import type { ChannelBinding, InboundChannelMedia, QueuedChannelInbound } from './channelBindingStore'

export type ChannelMediaRegion = 'CH' | 'EU'

export interface ChannelMediaDownload {
  readonly bytes: Uint8Array
  readonly mimeType: string
}

export interface ChannelMediaDownloader {
  download(input: { readonly mediaId: string; readonly maxBytes: number }): Promise<ChannelMediaDownload>
}

export interface ChannelBatchTranscriber {
  readonly processorRegion: ChannelMediaRegion
  transcribeFile(input: { readonly bytes: Uint8Array; readonly mimeType: string }): Promise<{ readonly text: string }>
}

export interface ChannelInboundMediaRuntime {
  readonly storageRegion: ChannelMediaRegion
  resolveWorkspace(binding: ChannelBinding): Promise<Workspace>
}

export interface PreparedChannelInbound {
  readonly text: string
  readonly attachments?: readonly ChatAttachmentPayload[]
  readonly requireIdle?: true
}

export class ChannelInboundMediaError extends Error {
  readonly code = ErrorCode.enum.CHANNEL_INBOUND_PARKED
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'ChannelInboundMediaError'
  }
}

const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const AUDIO_TYPES = new Map([
  ['audio/ogg', 'ogg'],
  ['audio/opus', 'opus'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
])

/** Host-owned media policy: provider bytes are retained only in the bound regional Workspace. */
export class ChannelInboundMediaService {
  constructor(
    private readonly runtime: ChannelInboundMediaRuntime,
    private readonly downloaders: ReadonlyMap<string, ChannelMediaDownloader>,
    private readonly transcriber: ChannelBatchTranscriber,
    private readonly options: { readonly maxImageBytes?: number; readonly maxAudioBytes?: number } = {},
  ) {
    if (runtime.storageRegion !== transcriber.processorRegion) {
      throw new ChannelInboundMediaError('Media storage and transcription processor must share the approved CH/EU region.', false)
    }
  }

  async prepare(binding: ChannelBinding, inbound: QueuedChannelInbound): Promise<PreparedChannelInbound> {
    const media = inbound.media
    if (!media) return { text: inbound.text }
    if (media.kind === 'document') {
      const isPdf = media.declaredMimeType ? normalizeMime(media.declaredMimeType) === 'application/pdf' : false
      return { text: isPdf
        ? 'The sender attached a PDF. PDFs are not supported on WhatsApp yet; ask them to send text, a photo, or a voice note instead.'
        : 'The sender attached a document type that is not supported on WhatsApp yet; ask them to send text, a photo, or a voice note instead.' }
    }
    const workspace = await this.runtime.resolveWorkspace(binding)
    if (!workspace.writeBinaryFile) throw new ChannelInboundMediaError('Bound Workspace does not support regional media retention.', false)
    const downloader = this.downloaders.get(inbound.channel)
    if (!downloader) throw new ChannelInboundMediaError('No authenticated media downloader is configured for this channel.', false)
    await workspace.mkdir('channel-media', { recursive: true })

    const allowed = media.kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES
    const maxBytes = media.kind === 'image' ? (this.options.maxImageBytes ?? 10 * 1024 * 1024) : (this.options.maxAudioBytes ?? 8 * 1024 * 1024)
    const stem = createHash('sha256').update(`${inbound.channel}\0${inbound.providerMessageId}\0${media.mediaId}`).digest('hex')
    const cached = await this.cachedPath(workspace, stem, allowed)
    let path: string
    let mimeType: string
    let bytes: Uint8Array
    if (cached) {
      path = cached.path
      mimeType = cached.mimeType
      if (!workspace.readBinaryFile) throw new ChannelInboundMediaError('Bound Workspace cannot read retained media.', false)
      bytes = await workspace.readBinaryFile(path)
    } else {
      const downloaded = await downloader.download({ mediaId: media.mediaId, maxBytes })
      mimeType = normalizeMime(downloaded.mimeType)
      const extension = allowed.get(mimeType)
      if (!extension) throw new ChannelInboundMediaError('Downloaded media type is unsupported.', false)
      bytes = downloaded.bytes
      path = `channel-media/${stem}.${extension}`
    }
    const declaredMimeType = media.declaredMimeType ? normalizeMime(media.declaredMimeType) : undefined
    if ((declaredMimeType && declaredMimeType !== mimeType) || bytes.byteLength === 0 || bytes.byteLength > maxBytes || !matchesContent(mimeType, bytes)) {
      throw new ChannelInboundMediaError('Downloaded media failed size, type, or content validation.', false)
    }
    if (!cached) await workspace.writeBinaryFile(path, bytes)

    if (media.kind === 'image') {
      const caption = inbound.text.trim()
      return {
        text: caption || 'Describe and respond to the attached WhatsApp photo.',
        attachments: [{ filename: `whatsapp-photo.${IMAGE_TYPES.get(mimeType)}`, mediaType: mimeType, url: `workspace://${path}`, path }],
        requireIdle: true,
      }
    }

    const transcriptPath = `channel-media/${stem}.txt`
    let transcript: string
    let cachedTranscript = true
    try {
      transcript = await workspace.readFile(transcriptPath)
    } catch {
      cachedTranscript = false
      transcript = (await this.transcriber.transcribeFile({ bytes, mimeType })).text
    }
    transcript = transcript.trim()
    if (!transcript || transcript.length > 100_000) throw new ChannelInboundMediaError('Voice transcription returned invalid text.', false)
    if (!cachedTranscript) await workspace.writeFile(transcriptPath, transcript)
    return { text: `The sender attached a WhatsApp voice note. Its self-hosted transcript follows:\n\n${transcript}` }
  }

  private async cachedPath(workspace: Workspace, stem: string, allowed: ReadonlyMap<string, string>): Promise<{ path: string; mimeType: string } | undefined> {
    for (const [mimeType, extension] of allowed) {
      const path = `channel-media/${stem}.${extension}`
      try {
        const stat = await workspace.stat(path)
        if (stat.kind === 'file' && stat.size > 0) return { path, mimeType }
      } catch {}
    }
    return undefined
  }
}

function normalizeMime(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase()
}

function matchesContent(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (mimeType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  if (mimeType === 'image/webp') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
  if (mimeType === 'audio/ogg' || mimeType === 'audio/opus') return ascii(bytes, 0, 4) === 'OggS'
  if (mimeType === 'audio/mp4') return ascii(bytes, 4, 8) === 'ftyp'
  if (mimeType === 'audio/mpeg') return (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
  if (mimeType === 'audio/wav') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE'
  return false
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end))
}
