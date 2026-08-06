// @vitest-environment node
import { EventEmitter } from "node:events"
import type { FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherBinding, WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LIVE_PCM_FRAME_BYTES } from "../../shared"
import { LiveTranscriptManager } from "../manager"
import type { WhisperLiveKitSnapshot } from "../whisperLiveKit"
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
  ensure: NonNullable<WorkspaceAgentDispatcherBinding["bindPiSession"]> = vi.fn(async () => ({
    visibleUserMessageTarget: { isIdle: async () => true, sendIfIdle: async (_input: unknown) => ({ status: "accepted" as const, cursor: 1 }) },
  })),
): WorkspaceAgentDispatcherResolver {
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
      return {
        dispatcher: await this.resolve({ workspaceId: "default", userId: "local" }),
        workspace,
        bindPiSession: ensure,
      }
    },
  }
}

const request = { id: "request-1", headers: {} } as FastifyRequest

afterEach(() => vi.useRealTimers())

describe("LiveTranscriptManager", () => {
  it("keeps direct Workspace access inside the AgentHost callback until the live session terminates", async () => {
    const workspace = new MemoryWorkspace()
    const abort = new AbortController()
    let callbackCompleted = false
    const dispatchReview = vi.fn(async (input, _onEvent, onAccepted) => {
      const accepted = {
        ref: { agentTypeId: "default", sessionId: input.sessionId },
        receipt: { accepted: true as const, cursor: 1, disposition: "prompt" as const, clientNonce: input.clientNonce },
      }
      await onAccepted?.(accepted)
      return accepted
    })
    const runWithWorkspaceAgent = vi.fn(async (input, run) => {
      expect(input).toMatchObject({
        agentTypeId: "default",
        context: { workspaceId: "default", userId: "local" },
        request,
      })
      await run({
        workspace,
        signal: abort.signal,
        dispatch: dispatchReview,
        interrupt: vi.fn(),
        stop: vi.fn(),
      })
      callbackCompleted = true
    })
    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: {
        runWithWorkspaceAgent,
        async resolve() { throw new Error("compatibility dispatcher must not be used") },
      } as WorkspaceAgentDispatcherResolver,
      agentTypeId: "default",
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      createUpstreamForTest: () => upstream,
    })

    const started = await manager.start(request, { sessionId: "chat-1" })
    expect(runWithWorkspaceAgent).toHaveBeenCalledOnce()
    expect(callbackCompleted).toBe(false)
    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))
    await expect(manager.review(started.liveSessionId)).resolves.toEqual({ status: "dispatched" })
    expect(dispatchReview).toHaveBeenCalledOnce()
    expect(dispatchReview.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "chat-1",
      content: expect.stringContaining("Review the live transcript"),
      displayMessage: expect.any(String),
    })

    await manager.stop(started.liveSessionId)
    await vi.waitFor(() => expect(callbackCompleted).toBe(true))
    expect(await workspace.readFile(started.transcriptPath)).toContain("- State: complete")
  })

  it("owns one process lease, redeems one nonce, projects full snapshots, and stops idempotently", async () => {
    const workspace = new MemoryWorkspace()
    let callbacks: { onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void; onFailure: (error: never) => void } | undefined
    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      createUpstreamForTest: (nextCallbacks) => {
        callbacks = nextCallbacks as typeof callbacks
        return upstream
      },
    })

    const started = await manager.start(request, { sessionId: "chat-1", title: "Weekly sync" })
    await expect(manager.start(request, { sessionId: "chat-1" })).rejects.toMatchObject({ code: "live_transcript_already_active" })
    expect(started.transcriptPath).toMatch(/^live-transcripts\/\d{4}-\d{2}-\d{2}-[a-f0-9]{24}\.md$/)

    const thief = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, thief as never)
    thief.emit("message", Buffer.from("wrong"), true)
    await vi.waitFor(() => expect(thief.closeCode).toBe(4401))

    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))
    expect(socket.sent).toEqual([new Uint8Array([1])])

    socket.emit("message", Buffer.alloc(LIVE_PCM_FRAME_BYTES), true)
    await vi.waitFor(() => expect(upstream.sendPcm).toHaveBeenCalledTimes(1))
    expect(socket.sent).toHaveLength(2)

    callbacks!.onSnapshot({
      remainingDiarizationSeconds: 0,
      lines: [
        { startSeconds: 3, speaker: 7, text: "Bonjour" },
        { startSeconds: 8, speaker: 11, text: "Oui" },
      ],
    })
    const [stopped, concurrent] = await Promise.all([
      manager.stop(started.liveSessionId),
      manager.stop(started.liveSessionId),
    ])
    const repeated = await manager.stop(started.liveSessionId)

    expect(concurrent).toEqual(stopped)
    expect(repeated).toEqual(stopped)
    expect(stopped.state).toBe("complete")
    expect(upstream.drain).toHaveBeenCalledOnce()
    expect(upstream.close).toHaveBeenCalledOnce()
    const markdown = await workspace.readFile(started.transcriptPath)
    expect(markdown).toContain("- State: complete")
    expect(markdown).toContain("[00:00:03] **Speaker 1:** Bonjour")
    expect(markdown).toContain("[00:00:08] **Speaker 2:** Oui")
    expect(manager.status(started.liveSessionId)).toMatchObject({ active: false, state: "complete" })
  })

  it("dispatches manual review through the exact bound Pi session target", async () => {
    const workspace = new MemoryWorkspace()
    const send = vi.fn(async (_input: unknown) => ({ status: "accepted" as const, cursor: 1 }))
    const ensure = vi.fn(async () => ({
        visibleUserMessageTarget: { isIdle: async () => true, sendIfIdle: send },
    }))
    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace, ensure),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      createUpstreamForTest: () => upstream,
    })
    const started = await manager.start(request, { sessionId: "chat-1" })
    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))

    await expect(manager.review(started.liveSessionId)).resolves.toEqual({ status: "dispatched" })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![0]).toMatchObject({ message: expect.stringContaining("[Manual transcript review]") })
    expect(send.mock.calls[0]![0]).toMatchObject({ message: expect.stringContaining(`\`${started.transcriptPath}\``) })
    await manager.close()
  })

  it("interrupts capture when the exact Pi session disappears during review delivery", async () => {
    const workspace = new MemoryWorkspace()
    const bindPiSession = vi.fn(async () => ({
      visibleUserMessageTarget: {
        isIdle: async () => true,
        sendIfIdle: async () => ({ status: "gone" as const }),
      },
    }))
    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace, bindPiSession),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      createUpstreamForTest: () => upstream,
    })
    const started = await manager.start(request, { sessionId: "chat-gone" })
    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))

    await expect(manager.review(started.liveSessionId)).resolves.toEqual({ status: "pending" })
    await vi.waitFor(() => expect(manager.status(started.liveSessionId)).toMatchObject({
      active: false,
      state: "interrupted",
      outcome: "live_transcript_session_not_found",
    }))
    expect(upstream.close).toHaveBeenCalled()
    await manager.close()
  })

  it("interrupts malformed PCM without buffering or retry", async () => {
    const workspace = new MemoryWorkspace()
    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      createUpstreamForTest: () => upstream,
    })
    const started = await manager.start(request, { sessionId: "chat-1" })
    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))
    socket.emit("message", Buffer.alloc(2), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId)).toMatchObject({
      active: false,
      state: "interrupted",
      outcome: "live_transcript_invalid_audio",
    }))
    expect(upstream.sendPcm).not.toHaveBeenCalled()
    expect(upstream.close).toHaveBeenCalledOnce()
  })

  it("enforces upstream message and rendered transcript byte limits at the boundary", async () => {
    const messageWorkspace = new MemoryWorkspace()
    let messageCallbacks: { onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void } | undefined
    const messageUpstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const messageManager = new LiveTranscriptManager({
      dispatcherResolver: resolver(messageWorkspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      maxUpstreamMessages: 1,
      createUpstreamForTest: (callbacks) => {
        messageCallbacks = callbacks
        return messageUpstream
      },
    })
    const messageStarted = await messageManager.start(request, { sessionId: "chat-1" })
    const messageSocket = new FakeSocket()
    messageManager.handleBrowserSocket(messageStarted.liveSessionId, messageSocket as never)
    messageSocket.emit("message", Buffer.from(messageStarted.socketNonce), true)
    await vi.waitFor(() => expect(messageManager.status(messageStarted.liveSessionId).state).toBe("active"))
    const snapshot = { remainingDiarizationSeconds: 0, lines: [{ startSeconds: 0, speaker: 1, text: "one" }] }
    messageCallbacks!.onSnapshot(snapshot)
    expect(messageManager.status(messageStarted.liveSessionId).active).toBe(true)
    messageCallbacks!.onSnapshot(snapshot)
    await vi.waitFor(() => expect(messageManager.status(messageStarted.liveSessionId)).toMatchObject({
      active: false,
      outcome: "live_transcript_limit_exceeded",
    }))

    const byteWorkspace = new MemoryWorkspace()
    let byteCallbacks: { onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void } | undefined
    const byteManager = new LiveTranscriptManager({
      dispatcherResolver: resolver(byteWorkspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      maxTranscriptBytes: 100,
      createUpstreamForTest: (callbacks) => {
        byteCallbacks = callbacks
        return { ...messageUpstream, close: vi.fn() }
      },
    })
    const byteStarted = await byteManager.start(request, { sessionId: "chat-1" })
    const byteSocket = new FakeSocket()
    byteManager.handleBrowserSocket(byteStarted.liveSessionId, byteSocket as never)
    byteSocket.emit("message", Buffer.from(byteStarted.socketNonce), true)
    await vi.waitFor(() => expect(byteManager.status(byteStarted.liveSessionId).state).toBe("active"))
    byteCallbacks!.onSnapshot({
      remainingDiarizationSeconds: 0,
      lines: [{ startSeconds: 0, speaker: 1, text: "x".repeat(200) }],
    })
    await vi.waitFor(() => expect(byteManager.status(byteStarted.liveSessionId)).toMatchObject({
      active: false,
      outcome: "live_transcript_limit_exceeded",
    }))
  })

  it("holds the pending lease across concurrent starts and releases it after startup failure", async () => {
    const workspace = new MemoryWorkspace()
    let releaseEnsure!: () => void
    const ensureGate = new Promise<void>((resolve) => { releaseEnsure = resolve })
    const ensure = vi.fn(async () => {
      await ensureGate
      return {
            visibleUserMessageTarget: { isIdle: async () => true, sendIfIdle: async (_input: unknown) => ({ status: "accepted" as const, cursor: 1 }) },
      }
    })
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace, ensure),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
    })

    const firstStart = manager.start(request, { sessionId: "chat-1" })
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce())
    await expect(manager.start(request, { sessionId: "chat-1" })).rejects.toMatchObject({
      code: "live_transcript_already_active",
    })
    releaseEnsure()
    const started = await firstStart
    await manager.interruptBeforeAttachment(started.liveSessionId, "attachment_failed")

    const retryWorkspace = new MemoryWorkspace()
    const retryEnsure = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("disposed"), { code: "AGENT_BINDING_DISPOSED" }))
      .mockResolvedValue({
            visibleUserMessageTarget: { isIdle: async () => true, sendIfIdle: async (_input: unknown) => ({ status: "accepted" as const, cursor: 1 }) },
      })
    const retryManager = new LiveTranscriptManager({
      dispatcherResolver: resolver(retryWorkspace, retryEnsure),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
    })
    await expect(retryManager.start(request, { sessionId: "chat-1" })).rejects.toMatchObject({
      code: "AGENT_BINDING_DISPOSED",
    })
    const retried = await retryManager.start(request, { sessionId: "chat-1" })
    await retryManager.interruptBeforeAttachment(retried.liveSessionId, "attachment_failed")
  })

  it("interrupts concurrent browser frames without acknowledging work after termination", async () => {
    const workspace = new MemoryWorkspace()
    let releaseSend!: () => void
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve })
    const upstream = {
      connect: vi.fn(async () => undefined),
      sendPcm: vi.fn(async () => await sendGate),
      drain: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      createUpstreamForTest: () => upstream,
    })
    const started = await manager.start(request, { sessionId: "chat-1" })
    const socket = new FakeSocket()
    manager.handleBrowserSocket(started.liveSessionId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId).state).toBe("active"))
    const frame = Buffer.alloc(LIVE_PCM_FRAME_BYTES)
    socket.emit("message", frame, true)
    socket.emit("message", frame, true)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId)).toMatchObject({
      active: false,
      state: "interrupted",
      outcome: "live_transcript_backpressure",
    }))
    releaseSend()
    await Promise.resolve()
    await Promise.resolve()
    expect(socket.sent).toEqual([new Uint8Array([1])])
    expect(upstream.close).toHaveBeenCalledOnce()
  })

  it("interrupts on Pi session replacement and permits a later local start", async () => {
    const workspace = new MemoryWorkspace()
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
    })
    const first = await manager.start(request, { sessionId: "chat-1" })
    await manager.interruptForSessionReplacement()
    expect(manager.status(first.liveSessionId)).toMatchObject({
      active: false,
      state: "interrupted",
      outcome: "live_transcript_attachment_failed",
    })

    const second = await manager.start(request, { sessionId: "chat-1" })
    expect(second.liveSessionId).not.toBe(first.liveSessionId)
    await manager.interruptBeforeAttachment(second.liveSessionId, "attachment_failed")
  })

  it("expires unattached setup with a stable terminal outcome", async () => {
    vi.useFakeTimers()
    const workspace = new MemoryWorkspace()
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
      setupTimeoutMs: 25,
    })
    const started = await manager.start(request, { sessionId: "chat-1" })
    await vi.advanceTimersByTimeAsync(25)
    await vi.waitFor(() => expect(manager.status(started.liveSessionId)).toMatchObject({
      active: false,
      state: "interrupted",
      outcome: "live_transcript_setup_timeout",
    }))
    expect(await workspace.readFile(started.transcriptPath)).toContain("- State: interrupted")
  })

  it("rejects unknown Pi sessions before creating a transcript and revision-conflict interrupts", async () => {
    const missingWorkspace = new MemoryWorkspace()
    const missingEnsure = vi.fn(async () => {
      throw Object.assign(new Error("missing"), { code: "SESSION_NOT_FOUND" })
    })
    const missing = new LiveTranscriptManager({
      dispatcherResolver: resolver(missingWorkspace, missingEnsure),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
    })
    await expect(missing.start(request, { sessionId: "unknown" })).rejects.toMatchObject({ code: "live_transcript_session_not_found" })
    expect(missingWorkspace.files.size).toBe(0)

    const internalEnsure = vi.fn(async () => {
      throw Object.assign(new Error("binding disposed"), { code: "AGENT_BINDING_DISPOSED" })
    })
    const internal = new LiveTranscriptManager({
      dispatcherResolver: resolver(new MemoryWorkspace(), internalEnsure),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
    })
    await expect(internal.start(request, { sessionId: "chat-1" })).rejects.toMatchObject({
      code: "AGENT_BINDING_DISPOSED",
    })

    const workspace = new MemoryWorkspace()
    const manager = new LiveTranscriptManager({
      dispatcherResolver: resolver(workspace),
      actorResolver: () => ({ workspaceId: "default", userId: "local" }),
      upstreamUrl: "ws://127.0.0.1:18772/asr",
    })
    const started = await manager.start(request, { sessionId: "chat-1" })
    workspace.mutateExternally(started.transcriptPath, "external bytes\n")
    const result = await manager.interruptBeforeAttachment(started.liveSessionId, "attachment_failed")
    expect(result).toMatchObject({ state: "interrupted", outcome: "live_transcript_revision_conflict" })
    expect(await workspace.readFile(started.transcriptPath)).toBe("external bytes\n")
  })
})
