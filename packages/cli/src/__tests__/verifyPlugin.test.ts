import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
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

  test("returns OK + empty outcomes when .pi/extensions/ doesn't exist", () => {
    const result = verifyPlugin({ workspaceRoot })
    expect(result.ok).toBe(true)
    expect(result.outcomes).toEqual([])
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
  })
})
