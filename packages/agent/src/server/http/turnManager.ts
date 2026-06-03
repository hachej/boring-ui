import { createUIMessageStream } from './sse.js'
import type { UIMessageChunk } from './sse.js'
import type { AgentHarness, SendMessageInput } from '../../shared/harness.js'
import { StreamBufferStore, type TurnBuffer } from './streamBuffer.js'
import {
  parseFileChangeChunk,
  type SessionChangesTracker,
} from './sessionChangesTracker.js'

function chunk(data: Record<string, unknown>): UIMessageChunk {
  return data as unknown as UIMessageChunk
}

interface RuntimeForTurn {
  harness: AgentHarness
  workdir: string
}

interface StartTurnOptions {
  sessionId: string
  turnId: string
  input: SendMessageInput
  resolveRuntime: () => Promise<RuntimeForTurn>
  sessionChangesTracker?: SessionChangesTracker
  onSubmitted?: () => void
  onStreamError?: (err: unknown) => void
  onStreamComplete?: () => void
}

export interface StartedTurn {
  turnId: string
  buffer: TurnBuffer
}

export interface TurnAlreadyActive {
  active: true
}

export type StartTurnResult = StartedTurn | TurnAlreadyActive

interface ReservedTurn {
  sessionId: string
  turnId: string
  abortController: AbortController
  buffer: TurnBuffer
}

interface CloseEmitter {
  on(event: 'close', listener: () => void): unknown
}

export class TurnManager {
  private readonly buffers = new StreamBufferStore()
  private readonly activeAbortControllersBySession = new Map<string, Map<string, AbortController>>()
  private readonly activeTurnBySession = new Map<string, string>()

  async startTurn(options: StartTurnOptions): Promise<StartTurnResult> {
    const reserved = this.reserve(options.sessionId, options.turnId)
    if (!reserved) return { active: true }

    try {
      const runtime = await options.resolveRuntime()
      options.onSubmitted?.()
      const chunks = runtime.harness.sendMessage(options.input, {
        abortSignal: reserved.abortController.signal,
        workdir: runtime.workdir,
      })

      this.pump(reserved, chunks, options)
      return { turnId: reserved.turnId, buffer: reserved.buffer }
    } catch (err) {
      this.cleanup(reserved)
      reserved.buffer.markComplete(() => this.buffers.evict(reserved.sessionId, reserved.turnId))
      throw err
    }
  }

  abortTurn(sessionId: string, turnId?: string): void {
    const requestedTurnId = turnId ?? this.activeTurnBySession.get(sessionId)
    if (!requestedTurnId) return
    this.activeAbortControllersBySession.get(sessionId)?.get(requestedTurnId)?.abort()
  }

  getActive(sessionId: string): { turnId: string; buffer: TurnBuffer } | undefined {
    return this.buffers.getActive(sessionId)
  }

  private reserve(sessionId: string, turnId: string): ReservedTurn | null {
    if (this.activeTurnBySession.has(sessionId)) return null

    const abortController = new AbortController()
    const sessionAbortControllers = this.activeAbortControllersBySession.get(sessionId) ?? new Map<string, AbortController>()
    sessionAbortControllers.set(turnId, abortController)
    this.activeAbortControllersBySession.set(sessionId, sessionAbortControllers)
    this.activeTurnBySession.set(sessionId, turnId)

    return {
      sessionId,
      turnId,
      abortController,
      buffer: this.buffers.create(sessionId, turnId),
    }
  }

  private pump(
    reserved: ReservedTurn,
    chunks: AsyncIterable<UIMessageChunk>,
    options: StartTurnOptions,
  ): void {
    void (async () => {
      let streamFailed = false
      try {
        reserved.buffer.append(chunk({ type: 'data-turn-start', data: { turnId: reserved.turnId } }))
        for await (const rawChunk of chunks) {
          const nextChunk = rawChunk as UIMessageChunk
          const fileChange = parseFileChangeChunk(nextChunk)
          if (fileChange) {
            options.sessionChangesTracker?.record(reserved.sessionId, fileChange)
          }
          reserved.buffer.append(nextChunk)
        }
      } catch (err) {
        streamFailed = true
        options.onStreamError?.(err)
        reserved.buffer.append({
          type: 'error',
          errorText: 'internal error',
        } as UIMessageChunk)
      } finally {
        this.cleanup(reserved)
        if (!streamFailed) options.onStreamComplete?.()
        // Completion only clears the active turn reservation. The stream buffer
        // remains active until its own TTL eviction so resume/replay can still
        // serve recently finished turns.
        reserved.buffer.markComplete(() => this.buffers.evict(reserved.sessionId, reserved.turnId))
      }
    })()
  }

  private cleanup(reserved: ReservedTurn): void {
    const sessionAbortControllers = this.activeAbortControllersBySession.get(reserved.sessionId)
    if (sessionAbortControllers?.get(reserved.turnId) === reserved.abortController) {
      sessionAbortControllers.delete(reserved.turnId)
      if (sessionAbortControllers.size === 0) this.activeAbortControllersBySession.delete(reserved.sessionId)
    }
    if (this.activeTurnBySession.get(reserved.sessionId) === reserved.turnId) {
      this.activeTurnBySession.delete(reserved.sessionId)
    }
  }
}

export function createBufferedUiMessageStream(
  buffer: TurnBuffer,
  closeEmitter: CloseEmitter,
  cursor = -1,
) {
  return createUIMessageStream({
    async execute({ writer }: { writer: { write(chunk: UIMessageChunk): void } }) {
      const replayed = buffer.replay(cursor)
      for (const e of replayed) writer.write(e.chunk)
      if (buffer.complete) return

      await new Promise<void>((resolve) => {
        const unsub = buffer.subscribe(
          (e) => writer.write(e.chunk),
          () => {
            unsub()
            resolve()
          },
        )
        closeEmitter.on('close', () => {
          unsub()
          resolve()
        })
      })
    },
  })
}
