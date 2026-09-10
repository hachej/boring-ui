import { describe, expect, test, vi } from 'vitest'
import { createSelfHostedBatchFileTranscriber, transcribeBatchFile } from '../dictation'

describe('self-hosted batch-file transcription seam', () => {
  test('posts retained bytes to the configured Whisper processor and exposes locality', async () => {
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json({ text: 'voice note transcript' }))
    const transcriber = createSelfHostedBatchFileTranscriber({
      upstreamWebSocketUrl: 'ws://127.0.0.1/asr', processorRegion: 'CH', bearerToken: 'lease-token', fetch: request,
    })
    expect(transcriber.processorRegion).toBe('CH')
    await expect(transcriber.transcribeFile({ bytes: new Uint8Array([79, 103, 103, 83, 1]), mimeType: 'audio/ogg' }))
      .resolves.toEqual({ text: 'voice note transcript' })
    expect(String(request.mock.calls[0]![0])).toBe('http://127.0.0.1/v1/audio/transcriptions')
    expect(request.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer lease-token' } })
    expect(request.mock.calls[0]![1]!.body).toBeInstanceOf(FormData)
  })

  test('rejects remote processors, unsupported types, and empty files before any processor call', async () => {
    expect(() => createSelfHostedBatchFileTranscriber({
      upstreamWebSocketUrl: 'wss://api.us.example/asr', processorRegion: 'EU',
    })).toThrow(/self-hosted loopback/)
    const request = vi.fn()
    await expect(transcribeBatchFile({
      upstreamWebSocketUrl: 'ws://127.0.0.1/live', mimeType: 'application/pdf', bytes: new Uint8Array([1]), fetch: request,
    })).rejects.toMatchObject({ code: 'live_transcript_invalid_audio' })
    await expect(transcribeBatchFile({
      upstreamWebSocketUrl: 'ws://127.0.0.1/live', mimeType: 'audio/ogg', bytes: new Uint8Array(), fetch: request,
    })).rejects.toMatchObject({ code: 'live_transcript_limit_exceeded' })
    expect(request).not.toHaveBeenCalled()
  })
})
