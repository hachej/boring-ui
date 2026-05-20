import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { writePluginSignatureCache } from "@hachej/boring-workspace/server"
import { formatVerifyResult, verifyPlugin } from "../server/verifyPlugin"

describe("verifyPlugin", () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "verify-plugin-"))
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  function plant(name: string, files: Record<string, string>) {
    const dir = join(workspaceRoot, ".pi", "extensions", name)
    mkdirSync(dir, { recursive: true })
    for (const [rel, content] of Object.entries(files)) {
      const path = join(dir, rel)
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, content, "utf8")
    }
    return dir
  }

  test("returns ok + empty outcomes when .pi/extensions/ doesn't exist, but flags the missing dir", () => {
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(true)
    expect(result.outcomes).toEqual([])
    expect(result.extensionsDirMissing).toBe(true)
    expect(result.extensionsDir).toContain(".pi/extensions")
  })

  test("formatVerifyResult WARNs when the extensions dir is missing (so agent doesn't think OK = success)", () => {
    const result = verifyPlugin({ workspaceRoot })
    const text = formatVerifyResult(result)
    expect(text).toMatch(/^WARNING/)
    expect(text).toContain("does not exist")
    expect(text).toContain(result.extensionsDir)
  })

  test("returns OK for a valid plugin with boring.front and an existing file", () => {
    plant("good", {
      "package.json": JSON.stringify({
        name: "good",
        version: "1.0.0",
        boring: { label: "Good", front: "front/index.tsx" },
        pi: { systemPrompt: "Good plugin." },
      }),
      "front/index.tsx": "export default {}",
    })
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(true)
    expect(result.outcomes).toHaveLength(1)
    expect(result.outcomes[0]).toMatchObject({ id: "good", ok: true, errors: [] })
  })

  test("reports INVALID_PLUGIN_METADATA when boring.server is set to true", () => {
    plant("bad-server", {
      "package.json": JSON.stringify({
        name: "bad-server",
        version: "1.0.0",
        boring: { label: "Bad", front: "front/index.tsx", server: true },
        pi: { systemPrompt: "Bad." },
      }),
      "front/index.tsx": "export default {}",
    })
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(false)
    expect(result.outcomes[0].ok).toBe(false)
    const joined = result.outcomes[0].errors.join("\n")
    expect(joined).toMatch(/boring\.server/i)
  })

  test("allows server/Pi-only plugins with no boring.front declaration", () => {
    plant("server-pi-only", {
      "package.json": JSON.stringify({
        name: "server-pi-only",
        version: "1.0.0",
        boring: { label: "Server/Pi", server: "server/index.ts" },
        pi: { systemPrompt: "Server/Pi only." },
      }),
      "server/index.ts": "export default {}",
    })
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(true)
    expect(result.outcomes[0]).toMatchObject({ id: "server-pi-only", ok: true, errors: [] })
    expect(result.outcomes[0].warnings[0]).toMatch(/boot-time\/static composition only/)
    expect(result.outcomes[0].warnings[0]).toMatch(/not import or register .*server routes\/agentTools/)
  })

  test("does not treat front/index.tsx as a runtime front convention when boring.front is absent", () => {
    plant("front-convention-only", {
      "package.json": JSON.stringify({
        name: "front-convention-only",
        version: "1.0.0",
        boring: { label: "Convention only" },
      }),
      "front/index.tsx": "export default {}",
    })
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(true)
    expect(result.outcomes[0].errors).toEqual([])
  })

  test("reports a missing boring.front file", () => {
    plant("missing-front", {
      "package.json": JSON.stringify({
        name: "missing-front",
        version: "1.0.0",
        boring: { label: "M", front: "front/index.tsx" },
        pi: { systemPrompt: "M." },
      }),
    })
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(false)
    const joined = result.outcomes[0].errors.join("\n")
    expect(joined).toContain("boring.front")
    expect(joined).toContain("front/index.tsx")
  })

  test("reports a front symlink escape", () => {
    const outside = join(workspaceRoot, "outside")
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "escape.tsx"), "export default {}", "utf8")
    const dir = plant("front-escape", {
      "package.json": JSON.stringify({
        name: "front-escape",
        version: "1.0.0",
        boring: { label: "Escape", front: "front/escape.tsx" },
      }),
    })
    mkdirSync(join(dir, "front"), { recursive: true })
    symlinkSync(join(outside, "escape.tsx"), join(dir, "front", "escape.tsx"))

    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(false)
    const joined = result.outcomes[0].errors.join("\n")
    expect(joined).toContain("boring.front")
    expect(joined).toMatch(/outside the plugin root/i)
  })

  test("reports pi.extension symlink escapes", () => {
    const outside = join(workspaceRoot, "outside-pi")
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "extension.ts"), "export default {}", "utf8")
    const dir = plant("pi-escape", {
      "package.json": JSON.stringify({
        name: "pi-escape",
        version: "1.0.0",
        boring: { label: "Pi", server: false },
        pi: { extensions: ["agent/extension.ts"] },
      }),
    })
    mkdirSync(join(dir, "agent"), { recursive: true })
    symlinkSync(join(outside, "extension.ts"), join(dir, "agent", "extension.ts"))

    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(false)
    const joined = result.outcomes[0].errors.join("\n")
    expect(joined).toContain("pi.extensions")
    expect(joined).toMatch(/outside the plugin root/i)
  })

  test("reports a missing boring.server file when boring.server is a string path", () => {
    plant("missing-server", {
      "package.json": JSON.stringify({
        name: "missing-server",
        version: "1.0.0",
        boring: { label: "S", front: "front/index.tsx", server: "server/index.ts" },
        pi: { systemPrompt: "S." },
      }),
      "front/index.tsx": "export default {}",
    })
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(false)
    const joined = result.outcomes[0].errors.join("\n")
    expect(joined).toContain("boring.server")
    expect(joined).toContain("server/index.ts")
  })

  test("reports a server symlink escape", () => {
    const outside = join(workspaceRoot, "outside-server")
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "server.ts"), "export default {}", "utf8")
    const dir = plant("server-escape", {
      "package.json": JSON.stringify({
        name: "server-escape",
        version: "1.0.0",
        boring: { label: "Server escape", front: "front/index.tsx", server: "server/index.ts" },
      }),
      "front/index.tsx": "export default {}",
    })
    mkdirSync(join(dir, "server"), { recursive: true })
    symlinkSync(join(outside, "server.ts"), join(dir, "server", "index.ts"))

    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(false)
    const joined = result.outcomes[0].errors.join("\n")
    expect(joined).toContain("boring.server")
    expect(joined).toMatch(/outside the plugin root/i)
  })

  test("reports malformed package.json", () => {
    plant("malformed", {
      "package.json": "{ not json",
    })
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(false)
    const joined = result.outcomes[0].errors.join("\n")
    expect(joined).toMatch(/not valid JSON/i)
  })

  test("name option scopes verification to one plugin", () => {
    plant("a", {
      "package.json": JSON.stringify({
        name: "a",
        boring: { label: "A", front: "front/index.tsx" },
      }),
      "front/index.tsx": "export default {}",
    })
    plant("b-broken", {
      "package.json": JSON.stringify({
        name: "b-broken",
        boring: { label: "B", front: "front/missing.tsx" },
      }),
    })
    // Verifying ONLY `a` skips b-broken's failure.
    const result = verifyPlugin({ workspaceRoot, name: "a" })
    expect(result.ok).toBe(true)
    expect(result.outcomes).toHaveLength(1)
    expect(result.outcomes[0].id).toBe("a")
  })

  test("formatVerifyResult prints actionable lines on failure", () => {
    plant("bad", {
      "package.json": JSON.stringify({
        name: "bad",
        boring: { label: "B", front: "front/index.tsx", server: true },
      }),
      "front/index.tsx": "export default {}",
    })
    const result = verifyPlugin({ workspaceRoot })
    const text = formatVerifyResult(result)
    expect(text).toMatch(/^FAILED/)
    expect(text).toContain("bad")
    expect(text).toContain("verify-plugin")
  })

  test("warns when the server file's signature differs from the load-time cache (restart needed)", () => {
    const dir = plant("drifted", {
      "package.json": JSON.stringify({
        name: "drifted",
        version: "1.0.0",
        boring: { label: "D", front: "front/index.tsx", server: "server/index.ts" },
      }),
      "front/index.tsx": "export default {}",
      "server/index.ts": "export default {}",
    })
    // Pretend the manager loaded this plugin with a different sig.
    writePluginSignatureCache(dir, { serverSignature: "0:0" })

    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(true)
    const outcome = result.outcomes.find((o) => o.id === "drifted")!
    expect(outcome.errors).toEqual([])
    expect(outcome.warnings).toHaveLength(2)
    expect(outcome.warnings[0]).toMatch(/boot-time\/static composition only/)
    expect(outcome.warnings[1]).toMatch(/server file changed/i)
    expect(outcome.warnings[1]).toMatch(/restart the workspace/i)

    const text = formatVerifyResult(result)
    expect(text).toMatch(/⚠ drifted/)
    expect(text).toContain("WARN:")
    expect(text).toMatch(/restart \(NOT just \/reload\)/)
  })

  test("does not emit a drift warning when the server file's signature matches the cache", () => {
    const dir = plant("fresh", {
      "package.json": JSON.stringify({
        name: "fresh",
        version: "1.0.0",
        boring: { label: "F", front: "front/index.tsx", server: "server/index.ts" },
      }),
      "front/index.tsx": "export default {}",
      "server/index.ts": "export default {}",
    })
    // Match the current mtime+size by computing it the same way.
    const serverPath = join(dir, "server/index.ts")
    const stat = statSync(serverPath)
    writePluginSignatureCache(dir, { serverSignature: `${stat.mtimeMs}:${stat.size}` })

    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(true)
    const outcome = result.outcomes.find((o) => o.id === "fresh")!
    expect(outcome.warnings).toHaveLength(1)
    expect(outcome.warnings[0]).toMatch(/boot-time\/static composition only/)
  })

  test("warns when the cache says no server but a server file was added (cache vs current mismatch)", () => {
    const dir = plant("added-server", {
      "package.json": JSON.stringify({
        name: "added-server",
        version: "1.0.0",
        boring: { label: "A", front: "front/index.tsx", server: "server/index.ts" },
      }),
      "front/index.tsx": "export default {}",
      "server/index.ts": "export default {}",
    })
    // Cache says the manager last loaded WITHOUT a server entry.
    writePluginSignatureCache(dir, { serverSignature: null })

    const result = verifyPlugin({ workspaceRoot })
    const outcome = result.outcomes.find((o) => o.id === "added-server")!
    expect(outcome.warnings).toHaveLength(2)
    expect(outcome.warnings[0]).toMatch(/boot-time\/static composition only/)
    expect(outcome.warnings[1]).toMatch(/server file changed/i)
    expect(outcome.warnings[1]).toMatch(/restart the workspace process/i)
  })

  test("formatVerifyResult prints a clean OK line when all pass", () => {
    plant("happy", {
      "package.json": JSON.stringify({
        name: "happy",
        boring: { label: "H", front: "front/index.tsx" },
      }),
      "front/index.tsx": "export default {}",
    })
    const result = verifyPlugin({ workspaceRoot })
    const text = formatVerifyResult(result)
    expect(text).toMatch(/^OK/)
    expect(text).toContain("✓ happy")
    // OK line should also surface the scanned dir so the agent can
    // confirm it's looking at the right place.
    expect(text).toContain(".pi/extensions")
  })
})
