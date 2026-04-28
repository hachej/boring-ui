import { describe, test, expect } from "vitest"
import { parseFixtureYaml } from "../yamlSchema"
import { EvalAny, isEvalRegex } from "../types"

describe("parseFixtureYaml", () => {
  test("parses minimal fixture with one prompt", () => {
    const yaml = `
prompts:
  - prompt: open README.md
    expect:
      tool: exec_ui
      params:
        kind: openFile
        params:
          path: README.md
`
    const fx = parseFixtureYaml(yaml)
    expect(fx.prompts).toHaveLength(1)
    expect(fx.prompts[0]!.prompt).toBe("open README.md")
    const exp = fx.prompts[0]!.expect
    expect(exp).toEqual({
      tool: "exec_ui",
      params: { kind: "openFile", params: { path: "README.md" } },
    })
  })

  test("resolves !EvalAny tag to the EvalAny symbol", () => {
    const yaml = `
prompts:
  - prompt: open something
    expect:
      tool: exec_ui
      params:
        kind: openPanel
        params:
          id: !EvalAny
          component: chart
`
    const fx = parseFixtureYaml(yaml)
    const exp = fx.prompts[0]!.expect as unknown as {
      params: { params: { id: unknown; component: unknown } }
    }
    expect(exp.params.params.id).toBe(EvalAny)
    expect(exp.params.params.component).toBe("chart")
  })

  test("resolves !EvalRegex tag to a matcher object with the right pattern", () => {
    const yaml = `
prompts:
  - prompt: open chart
    expect:
      tool: exec_ui
      params:
        kind: openPanel
        params:
          component: !EvalRegex "^chart:"
`
    const fx = parseFixtureYaml(yaml)
    const exp = fx.prompts[0]!.expect as unknown as {
      params: { params: { component: unknown } }
    }
    const comp = exp.params.params.component
    expect(isEvalRegex(comp)).toBe(true)
    if (isEvalRegex(comp)) {
      expect(comp.__evalRegex.test("chart:GDPC1")).toBe(true)
      expect(comp.__evalRegex.test("deck:foo")).toBe(false)
    }
  })

  test("preserves suite-level model + systemPrompt + defaults", () => {
    const yaml = `
model: claude-haiku-4-5-20251001
systemPrompt: |
  You are a helpful workspace assistant.
defaults:
  retries: 1
  timeoutMs: 45000
prompts:
  - prompt: open README.md
    expect:
      tool: exec_ui
`
    const fx = parseFixtureYaml(yaml)
    expect(fx.model).toBe("claude-haiku-4-5-20251001")
    expect(fx.systemPrompt).toMatch(/helpful workspace assistant/)
    expect(fx.defaults).toEqual({ retries: 1, timeoutMs: 45000 })
  })

  test("supports expectFirst (ordering mode)", () => {
    const yaml = `
prompts:
  - prompt: navigate to line 42 of foo.ts
    expectFirst:
      tool: exec_ui
      params:
        kind: openFile
        params:
          path: foo.ts
`
    const fx = parseFixtureYaml(yaml)
    expect(fx.prompts[0]!.expectFirst).toEqual({
      tool: "exec_ui",
      params: { kind: "openFile", params: { path: "foo.ts" } },
    })
  })

  test("supports expectNoToolCall: true (negative assertion)", () => {
    const yaml = `
prompts:
  - prompt: what is 2 + 2?
    expectNoToolCall: true
`
    const fx = parseFixtureYaml(yaml)
    expect(fx.prompts[0]!.expectNoToolCall).toBe(true)
  })

  test("supports parallel-call expect (array of ExpectedCall)", () => {
    const yaml = `
prompts:
  - prompt: open the README and tell me about it
    expect:
      - tool: exec_ui
        params:
          kind: openFile
          params:
            path: README.md
      - tool: read
        params:
          path: README.md
`
    const fx = parseFixtureYaml(yaml)
    expect(Array.isArray(fx.prompts[0]!.expect)).toBe(true)
    expect((fx.prompts[0]!.expect as Array<unknown>).length).toBe(2)
  })

  test("rejects non-object root", () => {
    expect(() => parseFixtureYaml("just a string")).toThrow(/YAML object/)
  })

  test("rejects missing prompts array", () => {
    expect(() => parseFixtureYaml(`model: claude\n`)).toThrow(
      /missing "prompts"/,
    )
  })
})
