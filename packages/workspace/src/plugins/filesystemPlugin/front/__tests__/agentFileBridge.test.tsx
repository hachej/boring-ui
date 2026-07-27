import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { events, workspaceEvents, userMeta } from "../../../../front/events"
import { filesystemEvents } from "../../shared/events"
import {
  emitFilesystemAgentFileChange,
  FilesystemAgentFileBridge,
  useAutoOpenAgentFiles,
} from "../agentFileBridge"

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

function Probe(props: {
  onOpen: (path: string) => void
  options?: Parameters<typeof useAutoOpenAgentFiles>[1]
}) {
  useAutoOpenAgentFiles(props.onOpen, props.options)
  return null
}

describe("filesystem agent file bridge", () => {
  beforeEach(() => events._reset())

  it("translates rename chunks into filesystem moved events", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.moved, fn)
    emitFilesystemAgentFileChange(chunk("rename", { oldPath: "src/old.ts" }))
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "src/old.ts",
        to: "src/x.ts",
        cause: "agent",
        toolCallId: "tc-1",
      }),
    )
  })

  it("drops rename chunks without oldPath", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.moved, fn)
    emitFilesystemAgentFileChange(chunk("rename"))
    expect(fn).not.toHaveBeenCalled()
  })

  it.each([
    ["unlink emits deleted", "unlink", {}, filesystemEvents.deleted],
    ["mkdir emits created", "mkdir", {}, filesystemEvents.created],
    ["write defaults to changed", "write", {}, filesystemEvents.changed],
    ["write with existsBefore=true emits changed", "write", { existsBefore: true }, filesystemEvents.changed],
    ["write with existsBefore=false emits created", "write", { existsBefore: false }, filesystemEvents.created],
    ["edit emits changed", "edit", {}, filesystemEvents.changed],
  ] as const)("%s", (_scenario, op, extras, expected) => {
    const fn = vi.fn()
    events.on(expected, fn)
    emitFilesystemAgentFileChange(chunk(op, extras))
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/x.ts", cause: "agent" }),
    )
  })

  it("preserves the filesystem identity on agent file events", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.created, fn)
    emitFilesystemAgentFileChange(chunk("write", { existsBefore: false, filesystem: "company_context" }))
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/x.ts", filesystem: "company_context", cause: "agent" }),
    )
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
    [
      "invalid filesystem",
      { type: "data-file-changed", data: { op: "unlink", path: "x", toolCallId: "tc", filesystem: 42 } },
    ],
  ])("rejects %s", (_label, input) => {
    const moved = vi.fn()
    const deleted = vi.fn()
    const created = vi.fn()
    const changed = vi.fn()
    events.on(filesystemEvents.moved, moved)
    events.on(filesystemEvents.deleted, deleted)
    events.on(filesystemEvents.created, created)
    events.on(filesystemEvents.changed, changed)
    emitFilesystemAgentFileChange(input)
    expect(moved).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
    expect(created).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })

  it("wires generic agent data events into filesystem events", () => {
    const fn = vi.fn()
    render(<FilesystemAgentFileBridge />)
    events.on(filesystemEvents.changed, fn)
    events.emit(workspaceEvents.agentData, { ts: Date.now(), part: chunk("edit") })
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/x.ts", cause: "agent" }),
    )
  })

  it("auto-opens only agent-created files", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)
    events.emit(filesystemEvents.created, {
      cause: "agent",
      toolCallId: "tc-1",
      ts: Date.now(),
      path: "src/foo.ts",
      kind: "file",
    })
    events.emit(filesystemEvents.created, {
      ...userMeta(),
      path: "src/bar.ts",
      kind: "file",
    })
    events.emit(filesystemEvents.created, {
      cause: "agent",
      toolCallId: "tc-1",
      ts: Date.now(),
      path: "src/new-dir",
      kind: "dir",
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith("src/foo.ts")
  })

  it("auto-open respects filesOnly and skip options", () => {
    const onOpen = vi.fn()
    render(
      <Probe
        onOpen={onOpen}
        options={{ filesOnly: false, skip: (path) => path.endsWith(".lock") }}
      />,
    )
    events.emit(filesystemEvents.created, {
      cause: "agent",
      toolCallId: "tc-1",
      ts: Date.now(),
      path: "src/new-dir",
      kind: "dir",
    })
    events.emit(filesystemEvents.created, {
      cause: "agent",
      toolCallId: "tc-1",
      ts: Date.now(),
      path: "pnpm-lock.lock",
      kind: "file",
    })
    expect(onOpen).toHaveBeenCalledWith("src/new-dir")
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
