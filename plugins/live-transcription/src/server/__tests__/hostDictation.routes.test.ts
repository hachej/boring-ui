// @vitest-environment node
import fastify, { type FastifyInstance } from "fastify"
import type {
  WorkspaceAgentDispatcherBinding,
  WorkspaceAgentDispatcherResolver,
} from "@hachej/boring-agent/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LIVE_TRANSCRIPT_BASE_PATH } from "../../shared"
import { createLiveTranscriptServerPlugin } from "../index"
import type { HostDictationEngine } from "../hostDictation"
import { MemoryWorkspace } from "./testWorkspace"

const canonicalHost = "localhost:43123"
const canonicalOrigin = `http://${canonicalHost}`
const actor = { workspaceId: "default", userId: "local" }

function fakeEngine(): HostDictationEngine & { started: number; cancelled: number } {
  let state: "idle" | "recording" | "decoding" = "idle"
  return {
    started: 0,
    cancelled: 0,
    getState: () => state,
    getBufferedMs: () => (state === "idle" ? 0 : 1_000),
    async start() {
      if (state !== "idle") throw Object.assign(new Error("busy"), { code: "live_transcript_already_active" })
      this.started++
      state = "recording"
    },
    async stop() {
      state = "idle"
      return "host transcript text"
    },
    cancel() {
      this.cancelled++
      state = "idle"
    },
  }
}

function resolver(workspace: MemoryWorkspace): WorkspaceAgentDispatcherResolver {
  return {
    async runWithWorkspaceAgent() { throw new Error("unused") },
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
        bindPiSession: (() => {}) as unknown as WorkspaceAgentDispatcherBinding["bindPiSession"],
      }
    },
  }
}

interface Harness {
  app: FastifyInstance
  engine: ReturnType<typeof fakeEngine>
  close(): Promise<void>
}

async function createHarness(enableHost: boolean): Promise<Harness> {
  const engine = fakeEngine()
  const plugin = createLiveTranscriptServerPlugin({
    dispatcherResolver: resolver(new MemoryWorkspace()),
    actorResolver: () => actor,
    authority: { listenerHost: "127.0.0.1", canonicalHost, canonicalOrigin },
    upstreamUrl: "ws://127.0.0.1:9/asr",
    hostDictationEnabled: enableHost,
    createHostDictationEngineForTest: (() => engine) as never,
  })
  const app = fastify({ logger: false })
  await app.register(plugin.routes!)
  await app.ready()
  return {
    app,
    engine,
    close: async () => { await app.close() },
  }
}

describe("host dictation routes", () => {
  let harness: Harness | undefined
  afterEach(async () => { await harness?.close(); harness = undefined })

  it("is disabled unless hostDictationEnabled is set", async () => {
    harness = await createHarness(false)
    const response = await harness.app.inject({
      method: "POST",
      url: `${LIVE_TRANSCRIPT_BASE_PATH}/host-dictation/start`,
      headers: { origin: canonicalOrigin, host: canonicalHost },
      payload: {},
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_disabled" } })
  })

  it("start/stop round-trips through the engine", async () => {
    harness = await createHarness(true)
    const start = await harness.app.inject({
      method: "POST",
      url: `${LIVE_TRANSCRIPT_BASE_PATH}/host-dictation/start`,
      headers: { origin: canonicalOrigin, host: canonicalHost },
      payload: {},
    })
    expect(start.statusCode).toBe(200)
    expect(start.json()).toEqual({ started: true })
    expect(harness.engine.started).toBe(1)

    const stop = await harness.app.inject({
      method: "POST",
      url: `${LIVE_TRANSCRIPT_BASE_PATH}/host-dictation/stop`,
      headers: { origin: canonicalOrigin, host: canonicalHost },
      payload: {},
    })
    expect(stop.statusCode).toBe(200)
    expect(stop.json()).toEqual({ text: "host transcript text" })

    const cancel = await harness.app.inject({
      method: "POST",
      url: `${LIVE_TRANSCRIPT_BASE_PATH}/host-dictation/cancel`,
      headers: { origin: canonicalOrigin, host: canonicalHost },
      payload: {},
    })
    expect(cancel.json()).toEqual({ cancelled: true })
    expect(harness.engine.cancelled).toBe(1)
  })

  it("rejects non-empty bodies on stop", async () => {
    harness = await createHarness(true)
    const response = await harness.app.inject({
      method: "POST",
      url: `${LIVE_TRANSCRIPT_BASE_PATH}/host-dictation/stop`,
      headers: { origin: canonicalOrigin, host: canonicalHost },
      payload: { extra: true },
    })
    expect(response.statusCode).toBe(400)
  })

  it("rejects cross-origin requests", async () => {
    harness = await createHarness(true)
    const response = await harness.app.inject({
      method: "POST",
      url: `${LIVE_TRANSCRIPT_BASE_PATH}/host-dictation/start`,
      headers: { origin: "http://evil.example", host: canonicalHost },
      payload: {},
    })
    expect(response.statusCode).toBe(403)
    expect(harness.engine.started).toBe(0)
  })
})
