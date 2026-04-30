/**
 * Integration coverage for the auto-open-agent-files pipeline.
 *
 * Walks the full chain a real chat session takes:
 *   SSE chunk shape (as the agent emits it)
 *     → emitAgentFileChange parses the chunk
 *     → workspace event bus fires the right event
 *     → useAutoOpenAgentFiles invokes the host's onOpen
 *
 * Why a SECOND test file: the unit suite (useAutoOpenAgentFiles.test.tsx)
 * pins the hook's filter logic by emitting bus events directly. That
 * doesn't catch a regression in `emitAgentFileChange` where a chunk
 * shape change makes the bus event never fire — the *symptom* is
 * "auto-open silently does nothing". This file feeds the actual SSE
 * chunk shape and asserts onOpen fires (or doesn't), so a chunk-shape
 * drift fails LOUDLY here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { events } from "../../events"
import { emitAgentFileChange } from "../../events/agentBridge"
import { useAutoOpenAgentFiles } from "../useAutoOpenAgentFiles"

function Probe(props: {
  onOpen: (path: string) => void
}) {
  useAutoOpenAgentFiles(props.onOpen)
  return null
}

beforeEach(() => {
  events._reset()
})

describe("useAutoOpenAgentFiles — SSE chunk → onOpen integration", () => {
  it("opens new files (write op with existsBefore: false)", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)

    // Mirror the exact chunk the agent emits via stream-adapter.
    emitAgentFileChange({
      type: "data-file-changed",
      data: {
        op: "write",
        path: "src/notes.md",
        existsBefore: false,
        toolCallId: "call_abc",
        timestamp: "2026-04-28T13:44:18.630Z",
        size: 11,
      },
    })

    expect(onOpen).toHaveBeenCalledWith("src/notes.md")
  })

  it("does NOT open on overwrite of an existing file (existsBefore: true)", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)

    emitAgentFileChange({
      type: "data-file-changed",
      data: {
        op: "write",
        path: "src/main.ts",
        existsBefore: true, // overwrite, not a fresh create
        toolCallId: "call_abc",
        timestamp: "2026-04-28T13:44:18.630Z",
        size: 200,
      },
    })

    // Overwrites become file:changed events; auto-open ignores them.
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("does NOT open on edit op (file already exists)", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)

    emitAgentFileChange({
      type: "data-file-changed",
      data: {
        op: "edit",
        path: "src/main.ts",
        toolCallId: "call_abc",
        timestamp: "2026-04-28T13:44:18.630Z",
      },
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it("does NOT open on mkdir (directory create — files-only filter)", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)

    emitAgentFileChange({
      type: "data-file-changed",
      data: {
        op: "mkdir",
        path: "src/new-folder",
        toolCallId: "call_abc",
        timestamp: "2026-04-28T13:44:18.630Z",
      },
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it("ignores chunks of other types (defensive)", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)

    // Unrelated SSE chunks must be a no-op — the onData handler is
    // invoked for EVERY chunk, not just file-change chunks.
    emitAgentFileChange({
      type: "tool-input-available",
      toolName: "write",
      input: { path: "src/notes.md" },
    })
    emitAgentFileChange(null)
    emitAgentFileChange("garbage")
    emitAgentFileChange({ type: "data-file-changed" }) // missing data
    emitAgentFileChange({ type: "data-file-changed", data: { op: "bogus" } }) // bad op

    expect(onOpen).not.toHaveBeenCalled()
  })

  it("regression: write WITHOUT existsBefore defaults to overwrite (no auto-open)", () => {
    // Documents the conservative default. Pre-fix, this is the chunk
    // shape every write produced — and it correctly does NOT auto-open
    // (we'd rather miss a new-file open than re-open every overwrite).
    // The fix is server-side: writeTool now sets existsBefore based on
    // a stat call. This test pins the safe default for any client that
    // hasn't been updated.
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)

    emitAgentFileChange({
      type: "data-file-changed",
      data: {
        op: "write",
        path: "src/main.ts",
        // existsBefore omitted
        toolCallId: "call_abc",
        timestamp: "2026-04-28T13:44:18.630Z",
        size: 11,
      },
    })

    expect(onOpen).not.toHaveBeenCalled()
  })
})
