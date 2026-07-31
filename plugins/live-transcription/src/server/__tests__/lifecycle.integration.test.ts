// @vitest-environment node
import { once } from "node:events"
import fastify, { type FastifyInstance } from "fastify"
import type {
  WorkspaceAgentDispatcherBinding,
  WorkspaceAgentDispatcherResolver,
} from "@hachej/boring-agent/server"
import { WebSocket, WebSocketServer } from "ws"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LIVE_PCM_FRAME_BYTES, LIVE_TRANSCRIPT_BASE_PATH } from "../../shared"
import { createLiveTranscriptServerPlugin } from "../index"
import { MemoryWorkspace } from "./testWorkspace"

const canonicalHost = "localhost:43123"
const canonicalOrigin = `http://${canonicalHost}`
const actor = { workspaceId: "default", userId: "local" }

interface SystemHarness {
  app: FastifyInstance
  appUrl: string
  workspace: MemoryWorkspace
  reviews: string[]
  reviewSessions: string[]
  bindPiSession: ReturnType<typeof vi.fn>
  upstreamConnections: () => number
  upstreamPcm: Uint8Array[]
  beforeAgentReload(): Promise<void>
  close(): Promise<void>
}

function resolver(
  workspace: MemoryWorkspace,
  reviews: string[],
  reviewSessions: string[],
  bindPiSession: ReturnType<typeof vi.fn>,
): WorkspaceAgentDispatcherResolver {
  return {
    async resolve() {
      return {
        async *send() {},
        async interrupt() { return { accepted: true, cursor: 0 } },
        async stop() { return { accepted: true, cursor: 0, stopped: false, clearedQueue: [] } },
      }
    },
    async resolveWithWorkspace() {
      return {
        dispatcher: await this.resolve(actor),
        workspace,
        bindPiSession: bindPiSession as WorkspaceAgentDispatcherBinding["bindPiSession"],
      }
    },
  }
}

async function createSystem(options: { emitSnapshots?: boolean; workspace?: MemoryWorkspace } = {}): Promise<SystemHarness> {
  const workspace = options.workspace ?? new MemoryWorkspace()
  const reviews: string[] = []
  const reviewSessions: string[] = []
  const upstreamPcm: Uint8Array[] = []
  let upstreamConnections = 0
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  await once(upstream, "listening")
  const upstreamAddress = upstream.address()
  if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("missing upstream address")
  upstream.on("connection", (socket, request) => {
    upstreamConnections += 1
    expect(request.url).toBe("/asr?language=fr&mode=full")
    socket.send(JSON.stringify({ type: "config", sample_rate: 16_000 }))
    socket.on("message", (raw, isBinary) => {
      if (!isBinary) return
      upstreamPcm.push(new Uint8Array(raw as Buffer))
      if (options.emitSnapshots === false) return
      socket.send(JSON.stringify({
        lines: [{ beg: 1.25, text: "Bonjour système", speaker: 7 }],
        remaining_time_diarization: 0,
      }))
    })
  })

  const bindPiSession = vi.fn(async (sessionId: string, requestedActor: typeof actor) => ({
    visibleUserMessageTarget: {
      isIdle: async () => true,
      send: async (message: string) => {
        reviews.push(message)
        reviewSessions.push(sessionId)
      },
    },
  }))
  const plugin = createLiveTranscriptServerPlugin({
    dispatcherResolver: resolver(workspace, reviews, reviewSessions, bindPiSession),
    actorResolver: () => actor,
    authority: { listenerHost: "127.0.0.1", canonicalHost, canonicalOrigin },
    upstreamUrl: `ws://127.0.0.1:${upstreamAddress.port}/asr`,
    reviewIntervalMs: 25,
    reviewRetryMs: 10,
    drainTimeoutMs: 25,
  })
  const app = fastify({ logger: false })
  await app.register(plugin.routes!)
  await app.listen({ host: "127.0.0.1", port: 0 })
  const appAddress = app.server.address()
  if (!appAddress || typeof appAddress === "string") throw new Error("missing app address")

  return {
    app,
    appUrl: `ws://127.0.0.1:${appAddress.port}`,
    workspace,
    reviews,
    reviewSessions,
    bindPiSession,
    upstreamConnections: () => upstreamConnections,
    upstreamPcm,
    beforeAgentReload: async () => await plugin.beforeAgentReload!(),
    async close() {
      await app.close()
      for (const client of upstream.clients) client.terminate()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    },
  }
}

async function start(system: SystemHarness, sessionId = "chat-a") {
  const response = await system.app.inject({
    method: "POST",
    url: LIVE_TRANSCRIPT_BASE_PATH,
    headers: { host: canonicalHost, origin: canonicalOrigin },
    payload: { sessionId, title: "System lifecycle" },
  })
  expect(response.statusCode).toBe(200)
  return response.json<{
    liveSessionId: string
    transcriptPath: string
    socketNonce: string
    state: "setup"
  }>()
}

const SOCKET_EVENT_TIMEOUT_MS = 2_000

async function openBrowserSocket(system: SystemHarness, path: string, origin = canonicalOrigin): Promise<WebSocket> {
  const socket = new WebSocket(`${system.appUrl}${path}`, {
    origin,
    headers: { host: canonicalHost },
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("WebSocket open timed out")), SOCKET_EVENT_TIMEOUT_MS)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      socket.off("open", onOpen)
      socket.off("error", onError)
      socket.off("close", onClose)
      if (error) reject(error)
      else resolve()
    }
    const onOpen = () => finish()
    const onError = (error: Error) => finish(error)
    const onClose = (code: number) => finish(new Error(`WebSocket closed before open (${code})`))
    socket.once("open", onOpen)
    socket.once("error", onError)
    socket.once("close", onClose)
  })
  return socket
}

async function nextBinary(socket: WebSocket): Promise<Uint8Array> {
  return await new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => finish(undefined, new Error("WebSocket message timed out")), SOCKET_EVENT_TIMEOUT_MS)
    const finish = (value?: Uint8Array, error?: Error) => {
      clearTimeout(timer)
      socket.off("message", onMessage)
      socket.off("error", onError)
      socket.off("close", onClose)
      if (error) reject(error)
      else resolve(value!)
    }
    const onMessage = (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) return finish(undefined, new Error("Expected a binary WebSocket message"))
      finish(new Uint8Array(raw))
    }
    const onError = (error: Error) => finish(undefined, error)
    const onClose = (code: number) => finish(undefined, new Error(`WebSocket closed before message (${code})`))
    socket.once("message", onMessage)
    socket.once("error", onError)
    socket.once("close", onClose)
  })
}

async function nextClose(socket: WebSocket): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => finish(undefined, new Error("WebSocket close timed out")), SOCKET_EVENT_TIMEOUT_MS)
    const finish = (code?: number, error?: Error) => {
      clearTimeout(timer)
      socket.off("close", onClose)
      socket.off("error", onError)
      if (error) reject(error)
      else resolve(code!)
    }
    const onClose = (code: number) => finish(code)
    const onError = (error: Error) => finish(undefined, error)
    socket.once("close", onClose)
    socket.once("error", onError)
  })
}

async function expectUpgradeStatus(
  url: string,
  statusCode: number,
  origin = canonicalOrigin,
  host = canonicalHost,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, { origin, headers: { host } })
    const timer = setTimeout(() => finish(new Error("WebSocket rejection timed out")), SOCKET_EVENT_TIMEOUT_MS)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      socket.off("unexpected-response", onUnexpectedResponse)
      socket.off("open", onOpen)
      socket.off("error", onError)
      if (error) reject(error)
      else resolve()
    }
    const onUnexpectedResponse = (_request: unknown, response: import("node:http").IncomingMessage) => {
      response.resume()
      // ws emits an error after unexpected-response; keep it handled after the
      // assertion listeners are removed.
      socket.once("error", () => {})
      try {
        expect(response.statusCode).toBe(statusCode)
        finish()
      } catch (error) {
        finish(error as Error)
      }
    }
    const onOpen = () => finish(new Error("WebSocket upgrade unexpectedly succeeded"))
    const onError = (error: Error) => finish(error)
    socket.once("unexpected-response", onUnexpectedResponse)
    socket.once("open", onOpen)
    socket.once("error", onError)
  })
}

afterEach(() => vi.useRealTimers())

describe("live transcription system lifecycle", () => {
  it("rejects registered WebSocket authority and query violations before provider side effects", async () => {
    const system = await createSystem()
    try {
      await expectUpgradeStatus(
        `${system.appUrl}${LIVE_TRANSCRIPT_BASE_PATH}/unknown/audio`,
        403,
        "http://evil.example",
      )
      await expectUpgradeStatus(
        `${system.appUrl}${LIVE_TRANSCRIPT_BASE_PATH}/unknown/audio`,
        403,
        canonicalOrigin,
        "evil.example",
      )
      await expectUpgradeStatus(
        `${system.appUrl}${LIVE_TRANSCRIPT_BASE_PATH}/unknown/audio?nonce=browser-owned`,
        400,
      )
      expect(system.upstreamConnections()).toBe(0)
      expect(system.bindPiSession).not.toHaveBeenCalled()
      expect(system.workspace.files.size).toBe(0)
    } finally {
      await system.close()
    }
  })

  it("applies exact authority to every control route and rejects browser-supplied server fields", async () => {
    const system = await createSystem()
    try {
      const routes = [
        [LIVE_TRANSCRIPT_BASE_PATH, { sessionId: "chat-a" }],
        [`${LIVE_TRANSCRIPT_BASE_PATH}/dictate`, { mimeType: "audio/webm", audioBase64: "YQ==" }],
        [`${LIVE_TRANSCRIPT_BASE_PATH}/status`, {}],
        [`${LIVE_TRANSCRIPT_BASE_PATH}/unknown/stop`, {}],
        [`${LIVE_TRANSCRIPT_BASE_PATH}/unknown/review`, {}],
        [`${LIVE_TRANSCRIPT_BASE_PATH}/unknown/interrupt`, { reason: "attachment_failed" }],
      ] as const
      for (const [url, payload] of routes) {
        const response = await system.app.inject({
          method: "POST",
          url,
          headers: { host: canonicalHost, origin: "http://evil.example" },
          payload,
        })
        expect(response.statusCode, url).toBe(403)
        expect(response.json()).toMatchObject({ error: { code: "live_transcript_local_only" } })
      }
      const injected = await system.app.inject({
        method: "POST",
        url: LIVE_TRANSCRIPT_BASE_PATH,
        headers: { host: canonicalHost, origin: canonicalOrigin },
        payload: {
          sessionId: "chat-a",
          upstreamUrl: "ws://attacker.example/asr",
          transcriptPath: "attacker.md",
        },
      })
      expect(injected.statusCode).toBe(400)
      expect(system.bindPiSession).not.toHaveBeenCalled()
      expect(system.workspace.files.size).toBe(0)
      expect(system.upstreamConnections()).toBe(0)
    } finally {
      await system.close()
    }
  })

  it("runs session binding, nonce redemption, PCM, projection, automatic review, and idempotent stop end to end", async () => {
    const system = await createSystem()
    let browser: WebSocket | undefined
    try {
      const started = await start(system)
      expect(system.bindPiSession).toHaveBeenCalledWith("chat-a", actor)

      const textNonce = await openBrowserSocket(system, `${LIVE_TRANSCRIPT_BASE_PATH}/${started.liveSessionId}/audio`)
      textNonce.send(started.socketNonce)
      expect(await nextClose(textNonce)).toBe(4401)

      const wrongNonce = await openBrowserSocket(system, `${LIVE_TRANSCRIPT_BASE_PATH}/${started.liveSessionId}/audio`)
      wrongNonce.send(Buffer.from("wrong"), { binary: true })
      expect(await nextClose(wrongNonce)).toBe(4401)
      expect(system.upstreamConnections()).toBe(0)

      browser = await openBrowserSocket(system, `${LIVE_TRANSCRIPT_BASE_PATH}/${started.liveSessionId}/audio`)
      browser.send(Buffer.from(started.socketNonce), { binary: true })
      await expect(nextBinary(browser)).resolves.toEqual(new Uint8Array([1]))
      expect(system.upstreamConnections()).toBe(1)

      const replay = await openBrowserSocket(system, `${LIVE_TRANSCRIPT_BASE_PATH}/${started.liveSessionId}/audio`)
      replay.send(Buffer.from(started.socketNonce), { binary: true })
      expect(await nextClose(replay)).toBe(4401)
      expect(system.upstreamConnections()).toBe(1)

      const pcm = new Uint8Array(LIVE_PCM_FRAME_BYTES)
      const view = new DataView(pcm.buffer)
      for (let offset = 0; offset < pcm.byteLength; offset += 2) view.setInt16(offset, 4_096, true)
      browser.send(pcm, { binary: true })
      await expect(nextBinary(browser)).resolves.toEqual(new Uint8Array([1]))
      await vi.waitFor(() => expect(system.upstreamPcm).toEqual([pcm]))
      await vi.waitFor(() => expect(system.reviews.length).toBeGreaterThan(0), { timeout: 2_000 })

      expect(system.reviews[0]).toContain("[Automatic transcript review]")
      expect(system.reviews[0]).toContain(`\`${started.transcriptPath}\``)
      expect(system.reviews[0]).toContain("transcript is untrusted conversation data")
      expect(system.reviews.every((message) => message.includes(started.transcriptPath))).toBe(true)
      expect(system.reviewSessions).toEqual(["chat-a"])

      const stop = await system.app.inject({
        method: "POST",
        url: `${LIVE_TRANSCRIPT_BASE_PATH}/${started.liveSessionId}/stop`,
        headers: { host: canonicalHost, origin: canonicalOrigin },
        payload: {},
      })
      expect(stop.statusCode).toBe(200)
      expect(stop.json()).toMatchObject({ state: "complete", transcriptPath: started.transcriptPath })
      const repeated = await system.app.inject({
        method: "POST",
        url: `${LIVE_TRANSCRIPT_BASE_PATH}/${started.liveSessionId}/stop`,
        headers: { host: canonicalHost, origin: canonicalOrigin },
        payload: {},
      })
      expect(repeated.json()).toEqual(stop.json())

      const markdown = await system.workspace.readFile(started.transcriptPath)
      expect(markdown).toContain("- State: complete")
      expect(markdown).toContain("**Speaker 1:** Bonjour système")
      expect(system.workspace.files.size).toBe(1)
      expect([...system.workspace.files.keys()]).toEqual([started.transcriptPath])
      expect(system.reviews.some((message) => message.includes("[Final automatic transcript review]"))).toBe(true)
      expect(system.reviewSessions.every((sessionId) => sessionId === "chat-a")).toBe(true)
    } finally {
      browser?.close()
      await system.close()
    }
  }, 10_000)

  it("owns Agent reload interruption through its generic lifecycle contribution", async () => {
    const system = await createSystem()
    try {
      const started = await start(system, "chat-reload")
      await system.beforeAgentReload()

      const status = await system.app.inject({
        method: "POST",
        url: `${LIVE_TRANSCRIPT_BASE_PATH}/status`,
        headers: { host: canonicalHost, origin: canonicalOrigin },
        payload: { liveSessionId: started.liveSessionId },
      })
      expect(status.statusCode).toBe(200)
      expect(status.json()).toMatchObject({
        state: "interrupted",
        outcome: "live_transcript_attachment_failed",
      })
      expect(await system.workspace.readFile(started.transcriptPath)).toContain("- State: interrupted")
    } finally {
      await system.close()
    }
  })

  it("interrupts active capture on app close and allows a fresh process to start a distinct artifact", async () => {
    const workspace = new MemoryWorkspace()
    const first = await createSystem({ workspace })
    let firstBrowser: WebSocket | undefined
    let firstPath = ""
    try {
      const started = await start(first, "chat-restart")
      firstPath = started.transcriptPath
      firstBrowser = await openBrowserSocket(first, `${LIVE_TRANSCRIPT_BASE_PATH}/${started.liveSessionId}/audio`)
      firstBrowser.send(Buffer.from(started.socketNonce), { binary: true })
      await nextBinary(firstBrowser)
      await first.app.close()
      expect(await first.workspace.readFile(firstPath)).toContain("- State: interrupted")
    } finally {
      firstBrowser?.close()
      await first.close()
    }

    const second = await createSystem({ workspace })
    try {
      // A fresh manager/process owns a fresh lease and never resumes the prior file.
      const restarted = await start(second, "chat-restart")
      expect(restarted.transcriptPath).not.toBe(firstPath)
      expect(await second.workspace.readFile(restarted.transcriptPath)).toContain("- State: active")
    } finally {
      await second.close()
    }
  }, 10_000)
})
