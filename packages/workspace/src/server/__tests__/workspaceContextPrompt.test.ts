/**
 * Tests for workspace context prompt injection.
 *
 * Group 1: pure unit tests for buildWorkspaceContextPrompt.
 * Group 2: integration tests confirming createWorkspaceAgentServer injects
 *          the context prompt only in non-vercel-sandbox modes.
 *
 * vi.mock redirects all modes to "direct" so the server can boot without real
 * bwrap/Vercel infra, but captures the systemPromptAppend value that
 * createWorkspaceAgentServer passes in — that's what we assert on.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { buildWorkspaceContextPrompt } from "../../app/server/createWorkspaceAgentServer"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"

// ── spy ───────────────────────────────────────────────────────────────────────
let capturedSystemPromptAppend: string | undefined

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...mod,
    createAgentApp: (opts: Parameters<typeof mod.createAgentApp>[0]) => {
      capturedSystemPromptAppend = opts?.systemPromptAppend
      return mod.createAgentApp({ ...opts, mode: "direct" })
    },
  }
})

// ── temp dir helpers ──────────────────────────────────────────────────────────
const tempDirs: string[] = []

beforeEach(() => {
  capturedSystemPromptAppend = undefined
})

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

// ── Group 1: pure unit tests ──────────────────────────────────────────────────
describe("buildWorkspaceContextPrompt — unit", () => {
  test("references $BORING_AGENT_WORKSPACE_ROOT, not an absolute path", () => {
    const prompt = buildWorkspaceContextPrompt()
    expect(prompt).toContain("$BORING_AGENT_WORKSPACE_ROOT")
    expect(prompt).not.toMatch(/^\//)
    // No line should start with a '/' (no hardcoded absolute paths)
    for (const line of prompt.split("\n")) {
      expect(line.trim()).not.toMatch(/^\//)
    }
  })

  test("contains .agents/skills — the correct skill directory", () => {
    const prompt = buildWorkspaceContextPrompt()
    expect(prompt).toContain(".agents/skills")
  })

  test("contains .boring-agent/bin — the shim directory", () => {
    const prompt = buildWorkspaceContextPrompt()
    expect(prompt).toContain(".boring-agent/bin")
  })

  test("does NOT contain .venv/ — shim dir is on PATH, not raw venv", () => {
    const prompt = buildWorkspaceContextPrompt()
    expect(prompt).not.toContain(".venv/")
  })
})

// ── Group 2: injection integration tests ─────────────────────────────────────
describe("createWorkspaceAgentServer — workspace context injection", () => {
  test("mode: 'direct' — workspace context IS injected", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-direct-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })
    await app.close()
    expect(capturedSystemPromptAppend).toBeDefined()
    expect(capturedSystemPromptAppend).toContain(buildWorkspaceContextPrompt())
  })

  test("mode: 'local' — workspace context IS injected", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-local-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "local",
      logger: false,
    })
    await app.close()
    expect(capturedSystemPromptAppend).toBeDefined()
    expect(capturedSystemPromptAppend).toContain(buildWorkspaceContextPrompt())
  })

  test("mode: 'vercel-sandbox' — workspace context is NOT injected", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-vs-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "vercel-sandbox",
      logger: false,
      plugins: [{ id: "my-plugin", systemPrompt: "Plugin prompt only." }],
    })
    await app.close()
    // Has plugin prompt but NOT the workspace context block
    expect(capturedSystemPromptAppend).toBeDefined()
    expect(capturedSystemPromptAppend).toContain("Plugin prompt only.")
    expect(capturedSystemPromptAppend).not.toContain(buildWorkspaceContextPrompt())
  })

  test("mode: undefined — workspace context IS injected (safe default)", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-undef-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
    })
    await app.close()
    expect(capturedSystemPromptAppend).toBeDefined()
    expect(capturedSystemPromptAppend).toContain(buildWorkspaceContextPrompt())
  })

  test("boring-ui docs prompt is included by default", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-docs-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })
    await app.close()
    expect(capturedSystemPromptAppend).toContain(buildBoringSystemPrompt())
  })

  test("plugin system prompts appear alongside workspace context in direct mode", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-plugin-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [{ id: "my-plugin", systemPrompt: "Plugin capabilities here." }],
    })
    await app.close()
    expect(capturedSystemPromptAppend).toContain(buildWorkspaceContextPrompt())
    expect(capturedSystemPromptAppend).toContain("Plugin capabilities here.")
  })

  test("workspace context precedes plugin system prompts", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-order-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [{ id: "my-plugin", systemPrompt: "Plugin capabilities here." }],
    })
    await app.close()
    const prompt = capturedSystemPromptAppend!
    const contextIdx = prompt.indexOf(buildWorkspaceContextPrompt())
    const pluginIdx = prompt.indexOf("Plugin capabilities here.")
    expect(contextIdx).toBeLessThan(pluginIdx)
  })

  test("vercel-sandbox omits workspace context even with default app prompts", async () => {
    const workspaceRoot = await makeTempDir("boring-wcp-vs-undef-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "vercel-sandbox",
      logger: false,
    })
    await app.close()
    expect(capturedSystemPromptAppend).toBeDefined()
    expect(capturedSystemPromptAppend).not.toContain(buildWorkspaceContextPrompt())
  })
})
