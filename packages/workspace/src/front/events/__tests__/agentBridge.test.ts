import { describe, it, expect, vi, beforeEach } from "vitest"
import { emitAgentFileChange } from "../agentBridge"
import { events } from "../index"

describe("emitAgentFileChange", () => {
  beforeEach(() => events._reset())

  function chunk(
    op: "write" | "edit" | "unlink" | "rename" | "mkdir",
    extra: Record<string, unknown> = {},
  ): unknown {
    return {
      type: "data-file-changed",
      data: {
        op,
        path: "src/x.ts",
        toolCallId: "tc-1",
        timestamp: "2026-04-28T10:00:00Z",
        ...extra,
      },
    }
  }

  it("rename → file:moved with from/to", () => {
    const fn = vi.fn()
    events.on("file:moved", fn)
    emitAgentFileChange(chunk("rename", { oldPath: "src/old.ts" }))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "src/old.ts",
        to: "src/x.ts",
        cause: "agent",
        toolCallId: "tc-1",
      }),
    )
  })

  it("rename without oldPath is dropped (no event fires)", () => {
    const fn = vi.fn()
    events.on("file:moved", fn)
    emitAgentFileChange(chunk("rename"))
    expect(fn).not.toHaveBeenCalled()
  })

  it("unlink → file:deleted", () => {
    const fn = vi.fn()
    events.on("file:deleted", fn)
    emitAgentFileChange(chunk("unlink"))
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "src/x.ts",
        cause: "agent",
        toolCallId: "tc-1",
      }),
    )
  })

  it("mkdir → file:created with kind=dir", () => {
    const fn = vi.fn()
    events.on("file:created", fn)
    emitAgentFileChange(chunk("mkdir"))
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "src/x.ts",
        kind: "dir",
        cause: "agent",
      }),
    )
  })

  it.each([
    // [scenario, op, extras, expectedEvent]
    ["write defaults to file:changed (no false 'new file')", "write", {}, "file:changed"],
    ["write with existsBefore=true → file:changed", "write", { existsBefore: true }, "file:changed"],
    ["write with existsBefore=false → file:created", "write", { existsBefore: false }, "file:created"],
    ["edit → file:changed", "edit", {}, "file:changed"],
  ] as const)("%s", (_scenario, op, extras, expected) => {
    const fn = vi.fn()
    const opposite = expected === "file:created" ? "file:changed" : "file:created"
    events.on(expected, fn)
    const sentinel = vi.fn()
    events.on(opposite, sentinel)
    emitAgentFileChange(chunk(op as "write" | "edit", extras))
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/x.ts", cause: "agent" }),
    )
    expect(sentinel).not.toHaveBeenCalled()
  })

  it.each([
    ["wrong type", { type: "data-other", data: { foo: "bar" } }],
    ["non-object", "not even an object"],
    ["null", null],
    [
      "bogus op",
      { type: "data-file-changed", data: { op: "explode", path: "x", toolCallId: "tc" } },
    ],
    [
      "missing path",
      { type: "data-file-changed", data: { op: "write", toolCallId: "tc" } },
    ],
    [
      "missing toolCallId",
      { type: "data-file-changed", data: { op: "unlink", path: "x" } },
    ],
  ])("rejects %s (no event fires)", (_label, chunk) => {
    const moved = vi.fn()
    const deleted = vi.fn()
    const created = vi.fn()
    const changed = vi.fn()
    events.on("file:moved", moved)
    events.on("file:deleted", deleted)
    events.on("file:created", created)
    events.on("file:changed", changed)
    emitAgentFileChange(chunk)
    expect(moved).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
    expect(created).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })
})
