import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createFolderModeApp, createWorkspacesModeApp, installBoundedCloseSignalHandlers } from "../server/cli.js"

const tempDirs: string[] = []
const originalFlag = process.env.BORING_LIVE_TRANSCRIPTS_ENABLED

afterEach(async () => {
  if (originalFlag === undefined) delete process.env.BORING_LIVE_TRANSCRIPTS_ENABLED
  else process.env.BORING_LIVE_TRANSCRIPTS_ENABLED = originalFlag
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("CLI live transcript composition", () => {
  test("folder mode advertises readiness and mounts exact-origin routes only when explicitly enabled", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-live-folder-"))
    tempDirs.push(workspaceRoot)
    const app = await createFolderModeApp({
      workspaceRoot,
      mode: "direct",
      provisionWorkspace: false,
      liveTranscripts: {
        enabled: true,
        listenerHost: "127.0.0.1",
        canonicalHost: "localhost:5200",
        canonicalOrigin: "http://localhost:5200",
        upstreamUrl: "ws://127.0.0.1:18772/asr",
      },
    })
    try {
      const meta = await app.inject({ method: "GET", url: "/api/v1/workspace/meta" })
      expect(meta.json()).toMatchObject({
        liveTranscripts: {
          ready: true,
          commands: ["/live start", "/live stop", "/live status", "/review transcript"],
        },
      })
      const wrongOrigin = await app.inject({
        method: "POST",
        url: "/api/v1/live-transcripts/status",
        headers: { host: "localhost:5200", origin: "http://evil.test" },
        payload: {},
      })
      expect(wrongOrigin.statusCode).toBe(403)
      expect(wrongOrigin.json()).toMatchObject({ error: { code: "live_transcript_local_only" } })

      const exactHeaders = { host: "localhost:5200", origin: "http://localhost:5200" }
      const emptyStatus = await app.inject({
        method: "POST",
        url: "/api/v1/live-transcripts/status",
        headers: exactHeaders,
        payload: {},
      })
      expect(emptyStatus.statusCode).toBe(404)
      expect(emptyStatus.json()).toMatchObject({ error: { code: "live_transcript_not_active" } })

      const createdSession = await app.inject({ method: "POST", url: "/api/v1/agent/pi-chat/sessions", payload: {} })
      expect(createdSession.statusCode).toBe(201)
      const sessionId = createdSession.json().id as string
      const started = await app.inject({
        method: "POST",
        url: "/api/v1/live-transcripts",
        headers: exactHeaders,
        payload: { sessionId, title: "Composed test" },
      })
      expect(started.statusCode).toBe(200)
      expect(started.json()).toMatchObject({ state: "setup", transcriptPath: expect.stringMatching(/^live-transcripts\//) })
      const liveSessionId = started.json().liveSessionId as string

      const review = await app.inject({
        method: "POST",
        url: `/api/v1/live-transcripts/${liveSessionId}/review`,
        headers: exactHeaders,
        payload: {},
      })
      expect(review.statusCode).toBe(503)
      expect(review.json()).toMatchObject({ error: { code: "live_transcript_disabled" } })

      const interrupted = await app.inject({
        method: "POST",
        url: `/api/v1/live-transcripts/${liveSessionId}/interrupt`,
        headers: exactHeaders,
        payload: { reason: "attachment_failed" },
      })
      expect(interrupted.statusCode).toBe(200)
      expect(interrupted.json()).toMatchObject({
        state: "interrupted",
        outcome: "live_transcript_attachment_failed",
      })
    } finally {
      await app.close()
    }
  }, 30_000)

  test("bounded signal handlers coalesce signals and await Fastify close", async () => {
    const server = new EventEmitter()
    let resolveClose: (() => void) | undefined
    const close = vi.fn(() => new Promise<void>((resolve) => { resolveClose = resolve }))
    const app = {
      close,
      server,
      log: { error: vi.fn() },
    } as never
    const previousInt = new Set(process.listeners("SIGINT"))
    const previousTerm = new Set(process.listeners("SIGTERM"))
    const dispose = installBoundedCloseSignalHandlers(app, 1_000)
    const onInt = process.listeners("SIGINT").find((listener) => !previousInt.has(listener))
    const onTerm = process.listeners("SIGTERM").find((listener) => !previousTerm.has(listener))
    expect(onInt).toBeDefined()
    expect(onTerm).toBeDefined()
    onInt!("SIGINT")
    onTerm!("SIGTERM")
    expect(close).toHaveBeenCalledOnce()
    resolveClose!()
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    server.emit("close")
    expect(process.listeners("SIGINT")).not.toContain(onInt)
    expect(process.listeners("SIGTERM")).not.toContain(onTerm)
    dispose()
  })

  test("flag-off folder metadata is inert and workspaces mode rejects flag-on startup", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-live-off-"))
    tempDirs.push(workspaceRoot)
    const app = await createFolderModeApp({
      workspaceRoot,
      mode: "direct",
      provisionWorkspace: false,
      liveTranscripts: {
        enabled: false,
        listenerHost: "127.0.0.1",
        canonicalHost: "localhost:5200",
        canonicalOrigin: "http://localhost:5200",
        upstreamUrl: "ws://127.0.0.1:18772/asr",
      },
    })
    try {
      const meta = await app.inject({ method: "GET", url: "/api/v1/workspace/meta" })
      expect(meta.json().liveTranscripts).toBeUndefined()
      const route = await app.inject({
        method: "POST",
        url: "/api/v1/live-transcripts/status",
        headers: { host: "localhost:5200", origin: "http://localhost:5200" },
        payload: {},
      })
      expect(route.statusCode).toBe(404)
    } finally {
      await app.close()
    }

    process.env.BORING_LIVE_TRANSCRIPTS_ENABLED = "1"
    await expect(createWorkspacesModeApp({ mode: "direct", provisionWorkspace: false })).rejects.toThrow("live_transcript_local_only")
  })
})
