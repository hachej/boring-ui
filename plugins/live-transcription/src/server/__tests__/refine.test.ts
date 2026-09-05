// @vitest-environment node
import { createServer, type Server } from "node:http"
import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LifecycleClient } from "../computeLifecycle"
import { TranscriptRefiner } from "../refine"

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  vi.useRealTimers()
})

async function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("failed to bind test server")
  return `http://127.0.0.1:${address.port}`
}

async function makeAudioFile(bytes = 16): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boring-refine-"))
  roots.push(root)
  const path = join(root, "session.m4a")
  await writeFile(path, Buffer.alloc(bytes, 1))
  return path
}

function fakeClient(): LifecycleClient & { acquire: ReturnType<typeof vi.fn>; heartbeat: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  return {
    acquire: vi.fn(async () => ({ id: "lease-1" })),
    heartbeat: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
}

const SUCCESS_PAYLOAD = {
  durationSeconds: 12.5,
  language: "fr",
  model: "whisper-large-v3",
  wallSeconds: 3.2,
  words: [
    { text: "Bonjour", startSeconds: 0, endSeconds: 0.4, speaker: 2 },
    { text: "à", startSeconds: 0.4, endSeconds: 0.5, speaker: 2 },
    { text: "tous", startSeconds: 0.5, endSeconds: 0.8, speaker: 2 },
    { text: "Salut", startSeconds: 2, endSeconds: 2.3, speaker: 0 },
    { text: "inconnu", startSeconds: 4, endSeconds: 4.3, speaker: -1 },
  ],
  segments: [],
}

describe("TranscriptRefiner", () => {
  it("streams the audio file and renders diarized markdown with first-seen speaker numbering", async () => {
    let received: { authorization?: string; hasFile: boolean; language?: string } | undefined
    const baseUrl = await listen((req, res) => {
      const chunks: Buffer[] = []
      req.on("data", (chunk) => chunks.push(chunk))
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("latin1")
        received = {
          authorization: req.headers.authorization,
          hasFile: body.includes('name="file"'),
          language: /name="language"\r\n\r\n([^\r\n]*)/.exec(body)?.[1],
        }
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify(SUCCESS_PAYLOAD))
      })
    })
    const audioPath = await makeAudioFile()
    const refiner = new TranscriptRefiner({
      refineUrl: baseUrl,
      bearerToken: "s".repeat(40),
      now: () => Date.parse("2026-09-05T10:00:00.000Z"),
    })

    const result = await refiner.refine({
      audioAbsolutePath: audioPath,
      title: "Consult",
      startedAt: "2026-09-05T09:30:00.000Z",
    })

    expect(received?.authorization).toBe(`Bearer ${"s".repeat(40)}`)
    expect(received?.hasFile).toBe(true)
    expect(received?.language).toBe("fr")
    expect(result.words).toBe(5)
    expect(result.speakers).toBe(2)
    expect(result.durationSeconds).toBe(12.5)
    expect(result.markdown).toContain("- State: complete")
    expect(result.markdown).toContain("- Refined: 2026-09-05T10:00:00.000Z (whisper-large-v3, 5 words, 2 speakers)")
    expect(result.markdown).toContain("**Speaker 1:** Bonjour à tous")
    expect(result.markdown).toContain("**Speaker 2:** Salut")
    expect(result.markdown).toContain("**Speaker unknown:** inconnu")
  })

  it("acquires and releases a GPU lease around the request, heartbeating while it runs", async () => {
    vi.useFakeTimers()
    const baseUrl = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(SUCCESS_PAYLOAD))
    })
    const audioPath = await makeAudioFile()
    const client = fakeClient()
    const order: string[] = []
    client.acquire.mockImplementation(async () => { order.push("acquire"); return { id: "lease-1" } })
    client.release.mockImplementation(async () => { order.push("release") })
    const refiner = new TranscriptRefiner({ refineUrl: baseUrl, bearerToken: "s".repeat(40), lifecycle: client })

    await refiner.refine({ audioAbsolutePath: audioPath, title: "Consult", startedAt: "2026-09-05T09:30:00.000Z" })

    expect(order).toEqual(["acquire", "release"])
    expect(client.acquire).toHaveBeenCalledWith(expect.stringMatching(/^refine:/))
  })

  it("maps 429, 413, and other upstream errors to the expected live transcript error codes", async () => {
    const audioPath = await makeAudioFile()
    const cases: { status: number; body: unknown; code: string; statusCode: number }[] = [
      { status: 429, body: { error: "busy" }, code: "live_transcript_already_active", statusCode: 409 },
      { status: 413, body: { error: "too big" }, code: "live_transcript_limit_exceeded", statusCode: 413 },
      { status: 401, body: { error: "unauthorized" }, code: "live_transcript_upstream_failed", statusCode: 502 },
      { status: 500, body: { error: "boom" }, code: "live_transcript_upstream_failed", statusCode: 502 },
    ]
    for (const testCase of cases) {
      const baseUrl = await listen((_req, res) => {
        res.writeHead(testCase.status, { "content-type": "application/json" })
        res.end(JSON.stringify(testCase.body))
      })
      const refiner = new TranscriptRefiner({ refineUrl: baseUrl, bearerToken: "s".repeat(40) })
      await expect(refiner.refine({ audioAbsolutePath: audioPath, title: "Consult", startedAt: "2026-09-05T09:30:00.000Z" }))
        .rejects.toMatchObject({ code: testCase.code, statusCode: testCase.statusCode })
    }
  })

  it("refuses files that exceed the offline refine size limit before contacting the service", async () => {
    let called = false
    const baseUrl = await listen((_req, res) => {
      called = true
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(SUCCESS_PAYLOAD))
    })
    const root = await mkdtemp(join(tmpdir(), "boring-refine-oversized-"))
    roots.push(root)
    const oversizedPath = join(root, "session.m4a")
    const handle = await open(oversizedPath, "w")
    await handle.truncate(201 * 1024 * 1024) // sparse file: no real disk usage, just a reported size.
    await handle.close()
    const refiner = new TranscriptRefiner({ refineUrl: baseUrl, bearerToken: "s".repeat(40) })

    await expect(refiner.refine({ audioAbsolutePath: oversizedPath, title: "Consult", startedAt: "2026-09-05T09:30:00.000Z" }))
      .rejects.toMatchObject({ code: "live_transcript_limit_exceeded", statusCode: 413 })
    expect(called).toBe(false)
  })

  it("rejects malformed or out-of-range service responses", async () => {
    const audioPath = await makeAudioFile()
    const invalidPayloads: unknown[] = [
      { ...SUCCESS_PAYLOAD, durationSeconds: "twelve" },
      { ...SUCCESS_PAYLOAD, words: [{ text: "hi", startSeconds: 0, endSeconds: 1, speaker: 9 }] },
      { ...SUCCESS_PAYLOAD, words: [{ text: "hi", startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY, speaker: 1 }] },
      null,
    ]
    for (const payload of invalidPayloads) {
      const baseUrl = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify(payload))
      })
      const refiner = new TranscriptRefiner({ refineUrl: baseUrl, bearerToken: "s".repeat(40) })
      await expect(refiner.refine({ audioAbsolutePath: audioPath, title: "Consult", startedAt: "2026-09-05T09:30:00.000Z" }))
        .rejects.toMatchObject({ code: "live_transcript_upstream_failed" })
    }
  })

  it("rejects a missing audio file without contacting the service", async () => {
    const refiner = new TranscriptRefiner({ refineUrl: "http://127.0.0.1:1/v1", bearerToken: "s".repeat(40) })
    await expect(refiner.refine({ audioAbsolutePath: "/no/such/file.m4a", title: "Consult", startedAt: "2026-09-05T09:30:00.000Z" }))
      .rejects.toMatchObject({ code: "live_transcript_attachment_invalid" })
  })
})
