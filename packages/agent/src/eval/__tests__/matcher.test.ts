import { describe, test, expect } from "vitest"
import {
  someCallMatches,
  firstCallMatches,
  noToolCallMatches,
  callSatisfies,
} from "../matcher"
import { EvalAny, EvalRegex, type ToolCall } from "../types"

const openFile = (path: string): ToolCall => ({
  tool: "exec_ui",
  params: { kind: "openFile", params: { path } },
})

const getUiState: ToolCall = { tool: "get_ui_state", params: {} }

describe("callSatisfies", () => {
  test("tool name match + no expected params → ok", () => {
    expect(callSatisfies({ tool: "get_ui_state" }, getUiState).ok).toBe(true)
  })

  test("tool name mismatch → fail", () => {
    const out = callSatisfies({ tool: "exec_ui" }, getUiState)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/tool mismatch/)
  })

  test("partial params match (extra keys in actual allowed)", () => {
    const actual: ToolCall = {
      tool: "exec_ui",
      params: { kind: "openFile", params: { path: "x.ts", mode: "view" } },
    }
    const out = callSatisfies(
      { tool: "exec_ui", params: { kind: "openFile", params: { path: "x.ts" } } },
      actual,
    )
    expect(out.ok).toBe(true)
  })

  test("strict mode rejects extra keys", () => {
    const actual: ToolCall = {
      tool: "exec_ui",
      params: { kind: "openFile", extra: 1 },
    }
    const out = callSatisfies(
      { tool: "exec_ui", params: { kind: "openFile" }, strict: true },
      actual,
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/strict/)
  })

  test("EvalAny matches any non-undefined value", () => {
    const actual = openFile("any-path")
    const out = callSatisfies(
      {
        tool: "exec_ui",
        params: { kind: "openFile", params: { path: EvalAny } },
      },
      actual,
    )
    expect(out.ok).toBe(true)
  })

  test("EvalAny rejects when key is missing", () => {
    const out = callSatisfies(
      {
        tool: "exec_ui",
        params: { kind: "openFile", params: { path: EvalAny } },
      },
      { tool: "exec_ui", params: { kind: "openFile", params: {} } },
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/missing/)
  })

  test("EvalRegex matches strings against the pattern", () => {
    const actual: ToolCall = {
      tool: "exec_ui",
      params: { kind: "openPanel", params: { id: "chart:GDPC1" } },
    }
    const out = callSatisfies(
      {
        tool: "exec_ui",
        params: {
          kind: "openPanel",
          params: { id: EvalRegex(/^chart:/) },
        },
      },
      actual,
    )
    expect(out.ok).toBe(true)
  })

  test("EvalRegex rejects non-matching strings", () => {
    const actual: ToolCall = {
      tool: "exec_ui",
      params: { kind: "openPanel", params: { id: "deck:foo" } },
    }
    const out = callSatisfies(
      {
        tool: "exec_ui",
        params: { params: { id: EvalRegex(/^chart:/) } },
      },
      actual,
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/does not match/)
  })

  test("EvalRegex rejects non-strings", () => {
    const actual: ToolCall = {
      tool: "exec_ui",
      params: { params: { id: 42 } },
    }
    const out = callSatisfies(
      {
        tool: "exec_ui",
        params: { params: { id: EvalRegex(/^chart:/) } },
      },
      actual,
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/expected string/)
  })

  test("primitive value mismatch fails with diff", () => {
    const out = callSatisfies(
      { tool: "exec_ui", params: { kind: "openFile" } },
      { tool: "exec_ui", params: { kind: "openPanel" } },
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/openFile.*openPanel/)
  })

  test("array length mismatch fails", () => {
    const out = callSatisfies(
      { tool: "t", params: { xs: [1, 2] } },
      { tool: "t", params: { xs: [1] } },
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/length mismatch/)
  })
})

describe("someCallMatches (default mode)", () => {
  test("each expected entry matches at least one actual call (any order)", () => {
    const actual: ToolCall[] = [openFile("a.ts"), getUiState]
    const out = someCallMatches(
      [
        { tool: "get_ui_state" },
        {
          tool: "exec_ui",
          params: { kind: "openFile", params: { path: "a.ts" } },
        },
      ],
      actual,
    )
    expect(out.ok).toBe(true)
  })

  test("single ExpectedCall is wrapped into array", () => {
    const out = someCallMatches({ tool: "get_ui_state" }, [getUiState])
    expect(out.ok).toBe(true)
  })

  test("expected entry not found → fail with closest mismatch reason", () => {
    const out = someCallMatches({ tool: "exec_ui" }, [getUiState])
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/no actual call matched/)
    expect(out.reason).toMatch(/closest mismatch/)
  })

  test("empty actual list with non-empty expected → fail", () => {
    const out = someCallMatches({ tool: "x" }, [])
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/actual was empty/)
  })

  test("partial-match propagates through parallel calls", () => {
    // The agent emitted three calls; we only care that two specific
    // ones are present, ignore the third.
    const actual: ToolCall[] = [
      openFile("README.md"),
      { tool: "read", params: { path: "README.md" } },
      { tool: "noise", params: {} },
    ]
    const out = someCallMatches(
      [
        {
          tool: "exec_ui",
          params: { kind: "openFile", params: { path: "README.md" } },
        },
        { tool: "read", params: { path: "README.md" } },
      ],
      actual,
    )
    expect(out.ok).toBe(true)
  })
})

describe("firstCallMatches (ordering mode)", () => {
  test("first call matches → ok", () => {
    const out = firstCallMatches(
      {
        tool: "exec_ui",
        params: { kind: "openFile", params: { path: "x.ts" } },
      },
      [openFile("x.ts"), getUiState],
    )
    expect(out.ok).toBe(true)
  })

  test("first call mismatches → fail (even if a later call would match)", () => {
    const out = firstCallMatches({ tool: "exec_ui" }, [getUiState, openFile("x.ts")])
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/tool mismatch/)
  })

  test("empty actual → fail with explicit reason", () => {
    const out = firstCallMatches({ tool: "x" }, [])
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/no tool calls/)
  })
})

describe("noToolCallMatches (negative assertion)", () => {
  test("empty actual → ok", () => {
    expect(noToolCallMatches([]).ok).toBe(true)
  })

  test("actual non-empty → fail, names listed in reason", () => {
    const out = noToolCallMatches([openFile("x"), getUiState])
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/2 tool call/)
    expect(out.reason).toMatch(/exec_ui, get_ui_state/)
  })
})
