// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Entry, Stat, Workspace } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import fastify, { type FastifyInstance } from "fastify"
import { readFile } from "node:fs/promises"
import { afterEach, describe, expect, it } from "vitest"
import { LIVE_TRANSCRIPT_BASE_PATH } from "../../shared"
import { createLiveTranscriptServerPlugin } from "../index"

const canonicalHost = "localhost:43124"
const canonicalOrigin = `http://${canonicalHost}`
const actor = { workspaceId: "default", userId: "local" }

/** Minimal real-filesystem-backed Workspace so `transcribe-file` can resolve realpaths. */
class LocalFsWorkspace implements Workspace {
  readonly runtimeContext = { runtimeCwd: this.root, mode: "direct" as const }
  constructor(readonly root: string) {}

  async readFile(relPath: string): Promise<string> {
    return await readFile(join(this.root, relPath), "utf-8")
  }
  async readBinaryFile(relPath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.root, relPath)))
  }
  async writeFile(relPath: string, data: string): Promise<void> {
    await writeFile(join(this.root, relPath), data)
  }
  async writeFileWithStat(relPath: string, data: string): Promise<Stat> {
    await writeFile(join(this.root, relPath), data)
    return await this.stat(relPath)
  }
  async writeBinaryFile(relPath: string, data: Uint8Array): Promise<void> {
    await writeFile(join(this.root, relPath), data)
  }
  async unlink(): Promise<void> {}
  async readdir(): Promise<Entry[]> { return [] }
  async stat(relPath: string): Promise<Stat> {
    const { stat: fsStat } = await import("node:fs/promises")
    const info = await fsStat(join(this.root, relPath))
    return { size: info.size, mtimeMs: info.mtimeMs, kind: info.isDirectory() ? "directory" : "file" }
  }
  async mkdir(relPath: string, opts?: { recursive?: boolean }): Promise<void> {
    await mkdir(join(this.root, relPath), { recursive: opts?.recursive })
  }
  async rename(): Promise<void> {}
}

function resolver(workspace: Workspace): WorkspaceAgentDispatcherResolver {
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
      return { dispatcher: await this.resolve(actor), workspace, bindPiSession: undefined }
    },
  }
}

const SUCCESS_PAYLOAD = {
  durationSeconds: 30,
  language: "fr",
  model: "test-model",
  wallSeconds: 1,
  words: [
    { text: "Bonjour", startSeconds: 0, endSeconds: 0.4, speaker: 1 },
    { text: "monde", startSeconds: 0.5, endSeconds: 0.8, speaker: 1 },
  ],
  segments: [],
}

async function createApp(options: { withRefiner?: boolean; root: string }): Promise<FastifyInstance> {
  const workspace = new LocalFsWorkspace(options.root)
  const plugin = createLiveTranscriptServerPlugin({
    dispatcherResolver: resolver(workspace),
    actorResolver: () => actor,
    authority: { listenerHost: "127.0.0.1", canonicalHost, canonicalOrigin },
    upstreamUrl: "ws://127.0.0.1:1/asr",
    ...(options.withRefiner === false ? {} : {
      refineUrl: "http://127.0.0.1:1/v1",
      refineBearerToken: "r".repeat(40),
      refineFetch: (async () => new Response(JSON.stringify(SUCCESS_PAYLOAD), { status: 200 })) as unknown as typeof fetch,
    }),
  })
  const app = fastify({ logger: false })
  await app.register(plugin.routes!)
  return app
}

async function transcribeFile(app: FastifyInstance, payload: Record<string, unknown>) {
  return await app.inject({
    method: "POST",
    url: `${LIVE_TRANSCRIPT_BASE_PATH}/transcribe-file`,
    headers: { host: canonicalHost, origin: canonicalOrigin },
    payload,
  })
}

const roots: string[] = []
const apps: FastifyInstance[] = []
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boring-transcribe-file-"))
  roots.push(root)
  return root
}

describe("POST /live-transcripts/transcribe-file", () => {
  it("refines a workspace-relative recording and writes a sibling transcript", async () => {
    const root = await makeRoot()
    await writeFile(join(root, "recording.m4a"), Buffer.alloc(16))
    const app = await createApp({ root })
    apps.push(app)

    const response = await transcribeFile(app, { path: "recording.m4a", title: "Consult" })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      transcriptPath: "recording.transcript.md",
      words: 2,
      speakers: 1,
      durationSeconds: 30,
    })
    const markdown = await readFile(join(root, "recording.transcript.md"), "utf-8")
    expect(markdown).toContain("- State: complete")
    expect(markdown).toContain("**Speaker 1:** Bonjour monde")
  })

  it("refuses to overwrite an existing transcript unless overwrite is set", async () => {
    const root = await makeRoot()
    await writeFile(join(root, "recording.m4a"), Buffer.alloc(16))
    await writeFile(join(root, "recording.transcript.md"), "# Existing\n")
    const app = await createApp({ root })
    apps.push(app)

    const blocked = await transcribeFile(app, { path: "recording.m4a" })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ error: { code: "live_transcript_revision_conflict" } })

    const allowed = await transcribeFile(app, { path: "recording.m4a", overwrite: true })
    expect(allowed.statusCode).toBe(200)
  })

  it("rejects traversal, absolute paths, and unsupported extensions", async () => {
    const root = await makeRoot()
    const app = await createApp({ root })
    apps.push(app)

    for (const path of ["../escape.m4a", "/etc/passwd", "notes.txt", "sub/../../escape.m4a"]) {
      const response = await transcribeFile(app, { path })
      expect(response.statusCode, path).toBe(400)
      expect(response.json()).toMatchObject({ error: { code: "live_transcript_attachment_invalid" } })
    }
  })

  it("rejects a symlink that escapes the workspace root", async () => {
    const root = await makeRoot()
    const outside = await makeRoot()
    await writeFile(join(outside, "secret.m4a"), Buffer.alloc(16))
    await symlink(join(outside, "secret.m4a"), join(root, "escape.m4a"))
    const app = await createApp({ root })
    apps.push(app)

    const response = await transcribeFile(app, { path: "escape.m4a" })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_attachment_invalid" } })
  })

  it("returns 503 when the offline refiner is not configured", async () => {
    const root = await makeRoot()
    await writeFile(join(root, "recording.m4a"), Buffer.alloc(16))
    const app = await createApp({ root, withRefiner: false })
    apps.push(app)

    const response = await transcribeFile(app, { path: "recording.m4a" })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_disabled" } })
  })
})
