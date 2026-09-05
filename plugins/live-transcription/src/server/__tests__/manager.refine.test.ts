// @vitest-environment node
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import type { FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherBinding, WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LiveTranscriptManager } from "../manager"
import type { TranscriptRefiner } from "../refine"
import { MemoryWorkspace } from "./testWorkspace"

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  sent: Uint8Array[] = []
  closeCode?: number

  send(data: Uint8Array, _options: unknown, callback: (error?: Error) => void): void {
    this.sent.push(new Uint8Array(data))
    callback()
  }

  close(code?: number): void {
    this.closeCode = code
    this.readyState = 3
    this.emit("close")
  }
}

function resolver(
  workspace: MemoryWorkspace,
  target: { isIdle: () => Promise<boolean>; sendIfIdle: (input: unknown) => Promise<unknown> },
): WorkspaceAgentDispatcherResolver {
  const ensure: NonNullable<WorkspaceAgentDispatcherBinding["bindPiSession"]> = vi.fn(async () => ({
    visibleUserMessageTarget: target,
  }))
  return {
    async runWithWorkspaceAgent() { throw new Error("direct resolver must not be used") },
    async resolve() {
      return {
        async *send() {},
        async interrupt() { return { accepted: true, cursor: 0 } },
        async stop() { return { accepted: true, cursor: 0, stopped: false, clearedQueue: [] } },
      }
    },
    async resolveWithWorkspace() {
      return { dispatcher: await this.resolve({ workspaceId: "default", userId: "local" }), workspace, bindPiSession: ensure }
    },
  }
}

const request = { id: "request-1", headers: {} } as FastifyRequest

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fakeFfmpeg(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boring-manager-refine-"))
  roots.push(root)
  const encoderPath = join(root, "fake-ffmpeg.mjs")
  await writeFile(encoderPath, `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
const chunks = []
process.stdin.on("data", (chunk) => chunks.push(chunk))
process.stdin.on("end", () => {
  const header = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp"), Buffer.alloc(120)])
  writeFileSync(process.argv.at(-1), header)
})
`)
  await chmod(encoderPath, 0o755)
  return encoderPath
}

describe("LiveTranscriptManager offline refinement", () => {
  it("refines a completed session's recording, rewrites the transcript, and notifies the review target", async () => {
    const workspace = new MemoryWorkspace()
    const audioRoot = await mkdtemp(join(tmpdir(), "boring-manager-refine-audio-"))
    roots.push(audioRoot)
    const ffmpegPath = await fakeFfmpeg()
    const sendIfIdle = vi.fn(async (_input: unknown) => ({ status: "accepted" as const, cursor: 1 }))
    const target = { isIdle: async () => true, sendIfIdle }

    let refineInput: { audioAbsolutePath: string; title: string; startedAt: string } | undefined
    const refiner: Pick<TranscriptRefiner, "refine"> = {
      refine: vi.fn(async (input) => {
        refineInput = input
        return { markdown: "# Refined\n\n- State: complete\n", words: 42, speakers: 2, durationSeconds: 90 }
      }),
    }

    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace, target),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      audioRecordingDirectory: audioRoot,
      audioRecordingFfmpegPath: ffmpegPath,
      refiner: refiner as TranscriptRefiner,
      createUpstreamForTest: () => upstream,
    })

    const started = await manager.start(request, { sessionId: "chat-1", title: "Weekly sync" })
    expect(started.audioPath).toBeDefined()
    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))

    const stopped = await manager.stop(started.liveSessionId)
    expect(stopped.state).toBe("complete")
    expect(stopped.audioPath).toBe(started.audioPath)

    await vi.waitFor(() => expect(refiner.refine).toHaveBeenCalledOnce())
    expect(refineInput?.audioAbsolutePath).toBe(`${audioRoot}/${started.audioPath!.slice("live-transcripts/".length)}`)
    expect(refineInput?.title).toBe("Weekly sync")

    // The review broker's final automatic review also uses this same target; only assert
    // that the refine notification specifically was delivered among whatever calls occurred.
    await vi.waitFor(() => expect(sendIfIdle.mock.calls.some((call) => (call[0] as { requestId?: string }).requestId === `refine:${started.liveSessionId}`)).toBe(true))
    const refineCall = sendIfIdle.mock.calls.find((call) => (call[0] as { requestId?: string }).requestId === `refine:${started.liveSessionId}`)
    expect(refineCall?.[0]).toMatchObject({
      requestId: `refine:${started.liveSessionId}`,
      message: expect.stringContaining("Transcript refined with the offline pass"),
    })
    await vi.waitFor(async () => {
      expect(await workspace.readFile(started.transcriptPath)).toBe("# Refined\n\n- State: complete\n")
    })
  })

  it("swallows refine failures via onRefineError without throwing from terminate", async () => {
    const workspace = new MemoryWorkspace()
    const audioRoot = await mkdtemp(join(tmpdir(), "boring-manager-refine-audio-"))
    roots.push(audioRoot)
    const ffmpegPath = await fakeFfmpeg()
    const target = { isIdle: async () => true, sendIfIdle: async () => ({ status: "accepted" as const, cursor: 1 }) }
    const onRefineError = vi.fn()
    const refiner: Pick<TranscriptRefiner, "refine"> = {
      refine: vi.fn(async () => { throw new Error("refine service unavailable") }),
    }
    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace, target),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      audioRecordingDirectory: audioRoot,
      audioRecordingFfmpegPath: ffmpegPath,
      refiner: refiner as TranscriptRefiner,
      onRefineError,
      createUpstreamForTest: () => upstream,
    })

    const started = await manager.start(request, { sessionId: "chat-1" })
    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))

    const stopped = await manager.stop(started.liveSessionId)
    expect(stopped.state).toBe("complete")

    await vi.waitFor(() => expect(onRefineError).toHaveBeenCalledOnce())
    expect(onRefineError.mock.calls[0]![0]).toBeInstanceOf(Error)
    expect(await workspace.readFile(started.transcriptPath)).toContain("- State: complete")
  })
})
