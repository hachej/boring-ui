// @vitest-environment node
import type { Entry, Stat, Workspace } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { LIVE_TRANSCRIPT_BASE_PATH } from "../../shared"
import { createLiveTranscriptServerPlugin } from "../index"

const canonicalHost = "localhost:43124"
const canonicalOrigin = `http://${canonicalHost}`
const actor = { workspaceId: "default", userId: "local" }

/** Minimal sandbox-style Workspace proving media reads stay on the public Workspace seam. */
class FakeSandboxWorkspace implements Workspace {
  readonly runtimeContext: { runtimeCwd: string; mode: "direct" }
  private readonly files = new Map<string, string>()
  private readonly binaryFiles = new Map<string, Uint8Array>()
  private readonly statSizes = new Map<string, number>()
  binaryReadCount = 0
  constructor(readonly root: string) {
    this.runtimeContext = { runtimeCwd: root, mode: "direct" }
  }

  async readFile(relPath: string): Promise<string> {
    const value = this.files.get(relPath)
    if (value === undefined) throw new Error(`not found: ${relPath}`)
    return value
  }
  async readBinaryFile(relPath: string): Promise<Uint8Array> {
    this.binaryReadCount += 1
    const value = this.binaryFiles.get(relPath)
    if (!value) throw new Error(`not found: ${relPath}`)
    return value
  }
  async writeFile(relPath: string, data: string): Promise<void> {
    this.files.set(relPath, data)
  }
  async writeFileWithStat(relPath: string, data: string): Promise<Stat> {
    await this.writeFile(relPath, data)
    return await this.stat(relPath)
  }
  async writeBinaryFile(relPath: string, data: Uint8Array): Promise<void> {
    this.binaryFiles.set(relPath, data)
  }
  async createBinaryFile(relPath: string, data: Uint8Array): Promise<void> {
    if (this.files.has(relPath) || this.binaryFiles.has(relPath)) {
      throw Object.assign(new Error(`already exists: ${relPath}`), { code: "EEXIST" })
    }
    this.files.set(relPath, new TextDecoder().decode(data))
  }
  setStatSize(relPath: string, size: number): void {
    this.binaryFiles.set(relPath, new Uint8Array())
    this.statSizes.set(relPath, size)
  }
  async unlink(relPath: string): Promise<void> { this.files.delete(relPath) }
  async readdir(): Promise<Entry[]> { return [] }
  async stat(relPath: string): Promise<Stat> {
    const value = this.files.get(relPath) ?? this.binaryFiles.get(relPath)
    if (value === undefined) throw new Error(`not found: ${relPath}`)
    return { size: this.statSizes.get(relPath) ?? (typeof value === "string" ? value.length : value.byteLength), mtimeMs: 0, kind: "file" }
  }
  async mkdir(): Promise<void> {}
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

async function createApp(options: {
  withRefiner?: boolean
  workspaceRoot: string
  audioRecordingDirectory?: string
  refineFetch?: typeof fetch
}): Promise<{ app: FastifyInstance; workspace: FakeSandboxWorkspace }> {
  const workspace = new FakeSandboxWorkspace(options.workspaceRoot)
  const plugin = createLiveTranscriptServerPlugin({
    dispatcherResolver: resolver(workspace),
    actorResolver: () => actor,
    authority: { listenerHost: "127.0.0.1", canonicalHost, canonicalOrigin },
    upstreamUrl: "ws://127.0.0.1:1/asr",
    audioRecordingDirectory: options.audioRecordingDirectory,
    ...(options.withRefiner === false ? {} : {
      refineUrl: "http://127.0.0.1:1/v1",
      refineBearerToken: "r".repeat(40),
      refineFetch: options.refineFetch ?? ((async () => new Response(JSON.stringify(SUCCESS_PAYLOAD), { status: 200 })) as unknown as typeof fetch),
    }),
  })
  const app = fastify({ logger: false })
  await app.register(plugin.routes!)
  return { app, workspace }
}

async function transcribeFile(app: FastifyInstance, payload: Record<string, unknown>) {
  return await app.inject({
    method: "POST",
    url: `${LIVE_TRANSCRIPT_BASE_PATH}/transcribe-file`,
    headers: { host: canonicalHost, origin: canonicalOrigin },
    payload,
  })
}

const apps: FastifyInstance[] = []
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("POST /live-transcripts/transcribe-file", () => {
  it("refines a recording through Workspace.readBinaryFile and writes a sibling transcript", async () => {
    const { app, workspace } = await createApp({ workspaceRoot: "/workspace" })
    apps.push(app)
    await workspace.writeBinaryFile("live-transcripts/recording.m4a", new Uint8Array(16))

    const response = await transcribeFile(app, { path: "live-transcripts/recording.m4a", title: "Consult" })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      transcriptPath: "live-transcripts/recording.transcript.md",
      words: 2,
      speakers: 1,
      durationSeconds: 30,
    })
    const markdown = await workspace.readFile("live-transcripts/recording.transcript.md")
    expect(markdown).toContain("- State: complete")
    expect(markdown).toContain("**Speaker 1:** Bonjour monde")
  })

  it("refuses to overwrite an existing transcript unless overwrite is set", async () => {
    const { app, workspace } = await createApp({ workspaceRoot: "/workspace" })
    apps.push(app)
    await workspace.writeBinaryFile("live-transcripts/recording.m4a", new Uint8Array(16))
    await workspace.writeFile("live-transcripts/recording.transcript.md", "# Existing\n")

    const blocked = await transcribeFile(app, { path: "live-transcripts/recording.m4a" })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ error: { code: "live_transcript_revision_conflict" } })

    const allowed = await transcribeFile(app, { path: "live-transcripts/recording.m4a", overwrite: true })
    expect(allowed.statusCode).toBe(200)
  })

  it("does not overwrite a transcript created while refinement is running", async () => {
    let workspace!: FakeSandboxWorkspace
    const createdDuringRefine = "# Created during refine\n"
    const setup = await createApp({
      workspaceRoot: "/workspace",
      refineFetch: (async () => {
        await workspace.writeFile("live-transcripts/recording.transcript.md", createdDuringRefine)
        return new Response(JSON.stringify(SUCCESS_PAYLOAD), { status: 200 })
      }) as unknown as typeof fetch,
    })
    workspace = setup.workspace
    apps.push(setup.app)
    await workspace.writeBinaryFile("live-transcripts/recording.m4a", new Uint8Array(16))

    const response = await transcribeFile(setup.app, { path: "live-transcripts/recording.m4a" })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_revision_conflict" } })
    expect(await workspace.readFile("live-transcripts/recording.transcript.md")).toBe(createdDuringRefine)
  })

  it("rejects paths outside live-transcripts/, traversal, absolute paths, and unsupported extensions", async () => {
    const { app } = await createApp({ workspaceRoot: "/workspace" })
    apps.push(app)

    for (const path of [
      "../escape.m4a",
      "/etc/passwd",
      "notes.txt",
      "sub/../../escape.m4a",
      "docs/x.m4a",
      "recording.m4a",
      "live-transcripts/../secrets/x.wav",
      "live-transcripts/sub/recording.m4a",
      "live-transcripts/recording.txt",
    ]) {
      const response = await transcribeFile(app, { path })
      expect(response.statusCode, path).toBe(400)
      expect(response.json()).toMatchObject({ error: { code: "live_transcript_attachment_invalid" } })
    }
  })

  it("rejects a recording the Workspace adapter cannot read", async () => {
    const { app } = await createApp({ workspaceRoot: "/workspace" })
    apps.push(app)

    const response = await transcribeFile(app, { path: "live-transcripts/missing.m4a" })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_attachment_invalid" } })
  })

  it("returns 503 when the offline refiner is not configured", async () => {
    const { app, workspace } = await createApp({ workspaceRoot: "/workspace", withRefiner: false })
    apps.push(app)
    await workspace.writeBinaryFile("live-transcripts/recording.m4a", new Uint8Array(16))

    const response = await transcribeFile(app, { path: "live-transcripts/recording.m4a" })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_disabled" } })
  })

  it("rejects an oversized workspace recording before allocating its bytes", async () => {
    const { app, workspace } = await createApp({ workspaceRoot: "/workspace" })
    apps.push(app)
    workspace.setStatSize("live-transcripts/recording.m4a", 200 * 1024 * 1024 + 1)

    const response = await transcribeFile(app, { path: "live-transcripts/recording.m4a" })
    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_limit_exceeded" } })
    expect(workspace.binaryReadCount).toBe(0)
  })

  it("does not require ambient host recording-directory configuration", async () => {
    const { app, workspace } = await createApp({ workspaceRoot: "/workspace" })
    apps.push(app)
    await workspace.writeBinaryFile("live-transcripts/recording.m4a", new Uint8Array(16))

    const response = await transcribeFile(app, { path: "live-transcripts/recording.m4a" })
    expect(response.statusCode).toBe(200)
  })
})
