import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("pi built-in tools opt-out", () => {
  const harnessSource = readFileSync(
    resolve(__dirname, "../createHarness.ts"),
    "utf8",
  )

  it("uses noTools: builtin to suppress pi defaults without disabling custom tools", () => {
    expect(harnessSource).toContain('noTools: "builtin"')
    expect(harnessSource).not.toMatch(/^\s*tools:\s*\[\],/m)
  })

  it("passes customTools to createAgentSession for our adapted tools", () => {
    expect(harnessSource).toContain("customTools: adaptToolsForPi")
  })

  it("does not pass createAgentSession default-tool flags", () => {
    expect(harnessSource).not.toContain("includeDefaultTools")
    expect(harnessSource).not.toContain("useBuiltinTools")
  })
})
