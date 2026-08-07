import WebSocket from "ws"
import { LiveTranscriptError } from "./errors"
import type { WhisperLiveKitSnapshot } from "./whisperLiveKit"

const KYUTAI_SAMPLE_RATE = 24_000
const KYUTAI_SILENCE_FRAMES_AFTER_MARKER = 35
const MAX_UPSTREAM_MESSAGE_BYTES = 1_000_000

/** Kyutai's `moshi-server` `/api/asr-streaming` MessagePack WebSocket adapter. */
export class KyutaiConnection {
  private socket: WebSocket | undefined
  private closing = false
  private markerId = 0
  private pendingMarker: Promise<void> | undefined
  private resolveMarker: (() => void) | undefined
  private rejectMarker: ((error: LiveTranscriptError) => void) | undefined
  private readonly words: Array<{ text: string; startSeconds: number; endSeconds?: number }> = []

  constructor(
    private readonly url: string,
    private readonly callbacks: {
      onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
      onFailure: (error: LiveTranscriptError) => void
    },
    private readonly options: { apiKey?: string; connectTimeoutMs?: number; highWaterBytes?: number } = {},
  ) {}

  async connect(): Promise<void> {
    const url = new URL(this.url)
    url.search = ""
    if (url.pathname !== "/api/asr-streaming") {
      throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai URL must target /api/asr-streaming.", 502)
    }
    const socket = new WebSocket(url, {
      maxPayload: MAX_UPSTREAM_MESSAGE_BYTES,
      ...(this.options.apiKey ? { headers: { "kyutai-api-key": this.options.apiKey } } : {}),
    })
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai connection timed out.", 504)), this.options.connectTimeoutMs ?? 5_000)
      socket.once("open", () => { clearTimeout(timer); resolve() })
      socket.once("error", () => { clearTimeout(timer); reject(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai connection failed.", 502)) })
      socket.once("close", () => { clearTimeout(timer); reject(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai closed before opening.", 502)) })
      socket.on("message", (data, isBinary) => {
        if (!isBinary) return this.fail(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai returned text output.", 502))
        try { this.acceptMessage(toBytes(data)) } catch (error) {
          this.fail(error instanceof LiveTranscriptError ? error : new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai output failed.", 502))
        }
      })
      socket.on("error", () => this.fail(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai connection failed.", 502)))
      socket.on("close", () => {
        if (!this.closing) this.fail(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai closed unexpectedly.", 502))
      })
    }).catch((error) => {
      this.closing = true
      socket.close()
      throw error
    })
  }

  async sendPcm(data: Uint8Array): Promise<void> {
    if (data.byteLength === 0 || data.byteLength % 2 !== 0) {
      throw new LiveTranscriptError("live_transcript_invalid_audio", "Kyutai PCM must contain complete 16-bit samples.", 400)
    }
    await this.send(encodeMessage({ type: "Audio", pcm: pcm16ToFloat32(data) }))
  }

  async drain(timeoutMs: number): Promise<void> {
    if (this.pendingMarker) return await this.pendingMarker
    const id = ++this.markerId
    this.pendingMarker = new Promise<void>((resolve, reject) => {
      this.resolveMarker = resolve
      this.rejectMarker = reject
    })
    try {
      await this.send(encodeMessage({ type: "Marker", id }))
      const silence = encodeMessage({ type: "Audio", pcm: new Float32Array(KYUTAI_SAMPLE_RATE / 10) })
      for (let index = 0; index < KYUTAI_SILENCE_FRAMES_AFTER_MARKER; index += 1) await this.send(silence)
      await Promise.race([
        this.pendingMarker,
        new Promise<never>((_, reject) => setTimeout(() => reject(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai did not finalize before the drain timeout.", 504)), timeoutMs)),
      ])
    } finally {
      this.pendingMarker = undefined
      this.resolveMarker = undefined
      this.rejectMarker = undefined
    }
  }

  close(): void {
    this.closing = true
    this.socket?.close()
  }

  private async send(data: Uint8Array): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai is not connected.", 502)
    if (socket.bufferedAmount > (this.options.highWaterBytes ?? 64 * 1024)) {
      throw new LiveTranscriptError("live_transcript_backpressure", "Kyutai socket exceeded the high-water mark.", 409)
    }
    await new Promise<void>((resolve, reject) => socket.send(data, { binary: true }, (error) => error
      ? reject(new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai audio send failed.", 502))
      : resolve()))
  }

  private acceptMessage(raw: Uint8Array): void {
    if (raw.byteLength > MAX_UPSTREAM_MESSAGE_BYTES) throw new LiveTranscriptError("live_transcript_limit_exceeded", "Kyutai message exceeded the size limit.", 413)
    const message = decodeMessage(raw)
    if (message.type === "Word") {
      if (typeof message.text !== "string" || typeof message.start_time !== "number" || !Number.isFinite(message.start_time)) {
        throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai returned an invalid word.", 502)
      }
      this.words.push({ text: message.text, startSeconds: Math.max(0, message.start_time) })
      this.publishSnapshot()
      return
    }
    if (message.type === "EndWord") {
      if (typeof message.stop_time !== "number" || !Number.isFinite(message.stop_time)) {
        throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai returned an invalid word boundary.", 502)
      }
      const word = this.words.at(-1)
      if (word) {
        word.endSeconds = Math.max(word.startSeconds, message.stop_time)
        this.publishSnapshot()
      }
      return
    }
    if (message.type === "Step" || message.type === "Ready") return
    if (message.type === "Marker") {
      if (message.id !== this.markerId) throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai returned an unexpected marker.", 502)
      this.resolveMarker?.()
      return
    }
    if (message.type === "Error") throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai rejected the stream.", 502)
    throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai returned an unsupported message.", 502)
  }

  private publishSnapshot(): void {
    this.callbacks.onSnapshot({ lines: this.words.map((word) => ({ ...word, speaker: 0 })), remainingDiarizationSeconds: 0 })
  }

  private fail(error: LiveTranscriptError): void {
    if (this.closing) return
    this.closing = true
    this.socket?.close()
    this.rejectMarker?.(error)
    this.callbacks.onFailure(error)
  }
}

export function pcm16ToFloat32(data: Uint8Array): Float32Array {
  const input = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const output = new Float32Array(data.byteLength / 2)
  for (let index = 0; index < output.length; index += 1) {
    output[index] = input.getInt16(index * 2, true) / 0x8000
  }
  return output
}

/** @deprecated Compatibility helper for callers that still hold 16 kHz PCM. */
export function resamplePcm16ToFloat32(data: Uint8Array): Float32Array {
  const input = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const inputLength = data.byteLength / 2
  const output = new Float32Array(Math.floor(inputLength * 3 / 2))
  for (let index = 0; index < output.length; index += 1) {
    const position = index * 2 / 3
    const left = Math.floor(position)
    const right = Math.min(inputLength - 1, left + 1)
    const fraction = position - left
    const sample = input.getInt16(left * 2, true) * (1 - fraction) + input.getInt16(right * 2, true) * fraction
    output[index] = Math.max(-1, Math.min(1, sample / 0x8000))
  }
  return output
}

type Message = { type: string; [key: string]: unknown }

function encodeMessage(message: { type: string; pcm?: Float32Array; id?: number }): Uint8Array {
  const entries = Object.entries(message).filter(([, value]) => value !== undefined)
  const chunks: Uint8Array[] = [new Uint8Array([0x80 | entries.length])]
  for (const [key, value] of entries) {
    chunks.push(encodeString(key))
    if (typeof value === "string") chunks.push(encodeString(value))
    else if (typeof value === "number") chunks.push(encodeInteger(value))
    else if (value instanceof Float32Array) {
      // MessagePack arrays encode each f32 with its own type tag; raw packed
      // IEEE bytes are not a valid representation of Rust's `Vec<f32>`.
      const bytes = new Uint8Array(5 + value.length * 5)
      bytes.set([0xdd, ...u32(value.length)], 0)
      const view = new DataView(bytes.buffer)
      for (let index = 0; index < value.length; index += 1) {
        const offset = 5 + index * 5
        bytes[offset] = 0xca
        view.setFloat32(offset + 1, value[index]!, false)
      }
      chunks.push(bytes)
    }
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function encodeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength > 31) throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai protocol key was too long.", 502)
  return new Uint8Array([0xa0 | bytes.byteLength, ...bytes])
}

function decodeMessage(raw: Uint8Array): Message {
  let offset = 0
  const read = (): unknown => {
    const prefix = raw[offset++]
    if (prefix === undefined) throw new Error("truncated")
    if (prefix >= 0x80 && prefix <= 0x8f) return readMap(prefix & 0x0f)
    if (prefix >= 0x90 && prefix <= 0x9f) return readArray(prefix & 0x0f)
    if (prefix >= 0xa0 && prefix <= 0xbf) return readString(prefix & 0x1f)
    if (prefix <= 0x7f) return prefix
    if (prefix >= 0xe0) return prefix - 0x100
    if (prefix === 0xca) return readFloat32()
    if (prefix === 0xcb) return readFloat64()
    if (prefix === 0xcc) return readByte()
    if (prefix === 0xcd) return readU16()
    if (prefix === 0xce) return readU32()
    if (prefix === 0xd0) return new DataView(raw.buffer, raw.byteOffset + offset++, 1).getInt8(0)
    if (prefix === 0xd1) return readI16()
    if (prefix === 0xd2) return readI32()
    if (prefix === 0xd9) return readString(readByte())
    if (prefix === 0xda) return readString(readU16())
    if (prefix === 0xdc) return readArray(readU16())
    if (prefix === 0xdd) return readArray(readU32())
    if (prefix === 0xde) return readMap(readU16())
    if (prefix === 0xdf) return readMap(readU32())
    throw new Error("unsupported")
  }
  const value = read()
  if (offset !== raw.byteLength || !value || typeof value !== "object" || typeof (value as Message).type !== "string") throw new Error("invalid")
  return value as Message

  function readMap(count: number): Message {
    if (count > 32) throw new Error("oversized")
    const map: Message = { type: "" }
    for (let index = 0; index < count; index += 1) {
      const key = read()
      if (typeof key !== "string") throw new Error("invalid key")
      map[key] = read()
    }
    return map
  }
  function readArray(count: number): unknown[] { if (count > 10_000) throw new Error("oversized"); return Array.from({ length: count }, () => read()) }
  function readByte(): number { const value = raw[offset++]; if (value === undefined) throw new Error("truncated"); return value }
  function readU16(): number { const value = new DataView(raw.buffer, raw.byteOffset + offset, 2).getUint16(0, false); offset += 2; return value }
  function readU32(): number { const value = new DataView(raw.buffer, raw.byteOffset + offset, 4).getUint32(0, false); offset += 4; return value }
  function readI16(): number { const value = new DataView(raw.buffer, raw.byteOffset + offset, 2).getInt16(0, false); offset += 2; return value }
  function readI32(): number { const value = new DataView(raw.buffer, raw.byteOffset + offset, 4).getInt32(0, false); offset += 4; return value }
  function readFloat32(): number { const value = new DataView(raw.buffer, raw.byteOffset + offset, 4).getFloat32(0, false); offset += 4; return value }
  function readFloat64(): number { const value = new DataView(raw.buffer, raw.byteOffset + offset, 8).getFloat64(0, false); offset += 8; return value }
  function readString(length: number): string { if (length > 20_000 || offset + length > raw.byteLength) throw new Error("string"); const value = new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(offset, offset + length)); offset += length; return value }
}

function encodeInteger(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai marker id was invalid.", 502)
  if (value < 0x80) return new Uint8Array([value])
  if (value <= 0xff) return new Uint8Array([0xcc, value])
  if (value <= 0xffff) return new Uint8Array([0xcd, value >> 8, value & 0xff])
  return new Uint8Array([0xce, ...u32(value)])
}
function u32(value: number): number[] { return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff] }
function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) { const size = data.reduce((total, part) => total + part.byteLength, 0); const merged = new Uint8Array(size); let offset = 0; for (const part of data) { merged.set(part, offset); offset += part.byteLength }; return merged }
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}
