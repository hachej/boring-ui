import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("pi built-in tools opt-out", () => {
  const harnessSource = readFileSync(
    resolve(__dirname, "../createHarness.ts"),
    "utf8",
  )

  it("passes tools: [] to createAgentSession to suppress pi defaults", () => {
    expect(harnessSource).toContain("tools: []")
  })

  it("passes customTools to createAgentSession for our adapted tools", () => {
    expect(harnessSource).toContain("customTools: adaptToolsForPi")
  })

  it("does not pass includeDefaults or similar flags", () => {
    expect(harnessSource).not.toContain("includeDefaults")
    expect(harnessSource).not.toContain("useBuiltinTools")
  })
})
