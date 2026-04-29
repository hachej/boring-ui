import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { events, agentMeta, userMeta } from "../../events"
import { useAutoOpenAgentFiles } from "../useAutoOpenAgentFiles"

function Probe(props: {
  onOpen: (path: string) => void
  options?: Parameters<typeof useAutoOpenAgentFiles>[1]
}) {
  useAutoOpenAgentFiles(props.onOpen, props.options)
  return null
}

beforeEach(() => {
  events._reset()
})

describe("useAutoOpenAgentFiles", () => {
  it("calls onOpen for agent-created files", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)
    events.emit("file:created", {
      ...agentMeta("tc-1"),
      path: "src/foo.ts",
      kind: "file",
    })
    expect(onOpen).toHaveBeenCalledWith("src/foo.ts")
  })

  it("ignores user-created files (user clicked, no need to re-open)", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)
    events.emit("file:created", {
      ...userMeta(),
      path: "src/foo.ts",
      kind: "file",
    })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("ignores agent-created directories by default (filesOnly)", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} />)
    events.emit("file:created", {
      ...agentMeta("tc-1"),
      path: "src/new-dir",
      kind: "dir",
    })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("opens directories when filesOnly: false", () => {
    const onOpen = vi.fn()
    render(<Probe onOpen={onOpen} options={{ filesOnly: false }} />)
    events.emit("file:created", {
      ...agentMeta("tc-1"),
      path: "src/new-dir",
      kind: "dir",
    })
    expect(onOpen).toHaveBeenCalledWith("src/new-dir")
  })

  it("respects skip predicate", () => {
    const onOpen = vi.fn()
    const skip = (p: string) => p.startsWith("node_modules/") || p.endsWith(".lock")
    render(<Probe onOpen={onOpen} options={{ skip }} />)
    events.emit("file:created", {
      ...agentMeta("tc-1"),
      path: "node_modules/cache.json",
      kind: "file",
    })
    events.emit("file:created", {
      ...agentMeta("tc-1"),
      path: "pnpm-lock.lock",
      kind: "file",
    })
    events.emit("file:created", {
      ...agentMeta("tc-1"),
      path: "src/main.ts",
      kind: "file",
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith("src/main.ts")
  })

  it("unsubscribes on unmount (no leaks)", () => {
    const onOpen = vi.fn()
    const { unmount } = render(<Probe onOpen={onOpen} />)
    unmount()
    events.emit("file:created", {
      ...agentMeta("tc-1"),
      path: "src/foo.ts",
      kind: "file",
    })
    expect(onOpen).not.toHaveBeenCalled()
  })
})
