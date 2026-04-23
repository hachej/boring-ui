import type { UIMessageChunk } from './sse.js'

const MAX_CHUNKS = 2000
const IDLE_TTL_MS = 60_000

interface BufferEntry {
  idx: number
  chunk: UIMessageChunk
}

type ChunkHandler = (entry: BufferEntry) => void

export class TurnBuffer {
  private ring: BufferEntry[] = []
  private nextIdx = 0
  private _complete = false
  private onChunk = new Set<ChunkHandler>()
  private onDone = new Set<() => void>()
  private gc: ReturnType<typeof setTimeout> | null = null

  append(chunk: UIMessageChunk): number {
    const idx = this.nextIdx++
    const entry: BufferEntry = { idx, chunk }
    this.ring.push(entry)
    if (this.ring.length > MAX_CHUNKS) this.ring.shift()
    for (const h of this.onChunk) h(entry)
    return idx
  }

  replay(afterCursor: number): BufferEntry[] {
    const i = this.ring.findIndex((e) => e.idx > afterCursor)
    return i === -1 ? [] : this.ring.slice(i)
  }

  subscribe(handler: ChunkHandler, done: () => void): () => void {
    if (this._complete) {
      done()
      return () => {}
    }
    this.onChunk.add(handler)
    this.onDone.add(done)
    return () => {
      this.onChunk.delete(handler)
      this.onDone.delete(done)
    }
  }

  markComplete(onEvict: () => void): void {
    this._complete = true
    for (const h of this.onDone) h()
    this.onChunk.clear()
    this.onDone.clear()
    this.gc = setTimeout(() => {
      this.ring = []
      onEvict()
    }, IDLE_TTL_MS)
  }

  get complete(): boolean {
    return this._complete
  }
  get highIdx(): number {
    return this.nextIdx - 1
  }
  get minIdx(): number {
    return this.ring[0]?.idx ?? this.nextIdx
  }

  dispose(): void {
    if (this.gc) clearTimeout(this.gc)
    this.ring = []
    this.onChunk.clear()
    this.onDone.clear()
  }
}

export class StreamBufferStore {
  private bufs = new Map<string, TurnBuffer>()
  private active = new Map<string, string>()

  create(sessionId: string, turnId: string): TurnBuffer {
    const buf = new TurnBuffer()
    this.bufs.set(`${sessionId}:${turnId}`, buf)
    this.active.set(sessionId, turnId)
    return buf
  }

  get(sessionId: string, turnId: string): TurnBuffer | undefined {
    return this.bufs.get(`${sessionId}:${turnId}`)
  }

  getActive(
    sessionId: string,
  ): { turnId: string; buffer: TurnBuffer } | undefined {
    const turnId = this.active.get(sessionId)
    if (!turnId) return undefined
    const buffer = this.bufs.get(`${sessionId}:${turnId}`)
    if (!buffer) {
      this.active.delete(sessionId)
      return undefined
    }
    return { turnId, buffer }
  }

  evict(sessionId: string, turnId: string): void {
    const k = `${sessionId}:${turnId}`
    this.bufs.get(k)?.dispose()
    this.bufs.delete(k)
    if (this.active.get(sessionId) === turnId) this.active.delete(sessionId)
  }
}
