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

/**
 * Minimal Workspace whose files live under a sandbox-style root that does not exist on the
 * host filesystem (mirrors the clinic deployment, where `workspace.root` is the sandbox-canonical
 * `/workspace` label). Only the transcript-write side of transcribe-file goes through this;
 * the audio recording itself is read from a separate, real host directory
 * (`audioRecordingDirectory`), exactly as in production.
 */
class FakeSandboxWorkspace implements Workspace {
  readonly runtimeContext = { runtimeCwd: this.root, mode: "direct" as const }
  private readonly files = new Map<string, string>()
  constructor(readonly root: string) {}

  async readFile(relPath: string): Promise<string> {
    const value = this.files.get(relPath)
    if (value === undefined) throw new Error(`not found: ${relPath}`)
    return value
  }
  async readBinaryFile(relPath: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.readFile(relPath))
  }
  async writeFile(relPath: string, data: string): Promise<void> {
    this.files.set(relPath, data)
  }
  async writeFileWithStat(relPath: string, data: string): Promise<Stat> {
    await this.writeFile(relPath, data)
    return await this.stat(relPath)
  }
  async writeBinaryFile(relPath: string, data: Uint8Array): Promise<void> {
    this.files.set(relPath, new TextDecoder().decode(data))
  }
  async unlink(relPath: string): Promise<void> { this.files.delete(relPath) }
  async readdir(): Promise<Entry[]> { return [] }
  async stat(relPath: string): Promise<Stat> {
    const value = this.files.get(relPath)
    if (value === undefined) throw new Error(`not found: ${relPath}`)
    return { size: value.length, mtimeMs: 0, kind: "file" }
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
      refineFetch: (async () => new Response(JSON.stringify(SUCCESS_PAYLOAD), { status: 200 })) as unknown as typeof fetch,
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

const dirs: string[] = []
const apps: FastifyInstance[] = []
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boring-transcribe-file-"))
  dirs.push(dir)
  return dir
}

describe("POST /live-transcripts/transcribe-file", () => {
  it("refines a recording from the audio recording directory and writes a sibling transcript into the workspace", async () => {
    const audioRecordingDirectory = await makeDir()
    await writeFile(join(audioRecordingDirectory, "recording.m4a"), Buffer.alloc(16))
    const { app, workspace } = await createApp({ workspaceRoot: "/workspace", audioRecordingDirectory })
    apps.push(app)

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
    const audioRecordingDirectory = await makeDir()
    await writeFile(join(audioRecordingDirectory, "recording.m4a"), Buffer.alloc(16))
    const { app, workspace } = await createApp({ workspaceRoot: "/workspace", audioRecordingDirectory })
    apps.push(app)
    await workspace.writeFile("live-transcripts/recording.transcript.md", "# Existing\n")

    const blocked = await transcribeFile(app, { path: "live-transcripts/recording.m4a" })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ error: { code: "live_transcript_revision_conflict" } })

    const allowed = await transcribeFile(app, { path: "live-transcripts/recording.m4a", overwrite: true })
    expect(allowed.statusCode).toBe(200)
  })

  it("rejects paths outside live-transcripts/, traversal, absolute paths, and unsupported extensions", async () => {
    const audioRecordingDirectory = await makeDir()
    const { app } = await createApp({ workspaceRoot: "/workspace", audioRecordingDirectory })
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

  it("rejects a symlink that escapes the audio recording directory", async () => {
    const audioRecordingDirectory = await makeDir()
    const outside = await makeDir()
    await writeFile(join(outside, "secret.m4a"), Buffer.alloc(16))
    await symlink(join(outside, "secret.m4a"), join(audioRecordingDirectory, "escape.m4a"))
    const { app } = await createApp({ workspaceRoot: "/workspace", audioRecordingDirectory })
    apps.push(app)

    const response = await transcribeFile(app, { path: "live-transcripts/escape.m4a" })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_attachment_invalid" } })
  })

  it("returns 503 when the offline refiner is not configured", async () => {
    const audioRecordingDirectory = await makeDir()
    await writeFile(join(audioRecordingDirectory, "recording.m4a"), Buffer.alloc(16))
    const { app } = await createApp({ workspaceRoot: "/workspace", audioRecordingDirectory, withRefiner: false })
    apps.push(app)

    const response = await transcribeFile(app, { path: "live-transcripts/recording.m4a" })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_disabled" } })
  })

  it("returns 503 when no audio recording directory is configured", async () => {
    const { app } = await createApp({ workspaceRoot: "/workspace" })
    apps.push(app)

    const response = await transcribeFile(app, { path: "live-transcripts/recording.m4a" })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: "live_transcript_disabled" } })
  })
})
