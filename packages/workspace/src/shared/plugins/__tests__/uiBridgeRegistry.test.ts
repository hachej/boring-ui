import { afterEach, describe, expect, it, vi } from "vitest"
import type { CommandResult, UiBridge, UiCommand } from "../../ui-bridge"
import {
  execWorkspaceUi,
  getWorkspaceUiBridge,
  NoWorkspaceUiBridgeError,
  notify,
  openPanel,
  registerWorkspaceUiBridge,
} from "../uiBridgeRegistry"

function makeBridge(): { bridge: UiBridge; posted: UiCommand[] } {
  const posted: UiCommand[] = []
  const bridge: UiBridge = {
    getState: async () => null,
    setState: async () => {},
    postCommand: async (cmd: UiCommand): Promise<CommandResult> => {
      posted.push(cmd)
      return { seq: posted.length, status: "ok" }
    },
    subscribeCommands: () => () => {},
  }
  return { bridge, posted }
}

describe("workspace UI bridge registry", () => {
  afterEach(() => {
    // Clear the globalThis slot so no bridge leaks across tests:
    // register-then-immediately-unregister always empties it.
    registerWorkspaceUiBridge(makeBridge().bridge)()
  })

  it("throws an actionable error when no bridge is registered", async () => {
    await expect(execWorkspaceUi({ kind: "openPanel", params: { id: "a", component: "b" } })).rejects.toBeInstanceOf(
      NoWorkspaceUiBridgeError,
    )
    await expect(openPanel({ id: "a", component: "b" })).rejects.toBeInstanceOf(NoWorkspaceUiBridgeError)
  })

  it("dispatches openPanel through the registered bridge (no URL, no fetch)", async () => {
    const { bridge, posted } = makeBridge()
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const unregister = registerWorkspaceUiBridge(bridge)
    try {
      const result = await openPanel({ id: "demo.slash-open", component: "demo.panel", params: { source: "/x" } })
      expect(result).toEqual({ seq: 1, status: "ok" })
      expect(posted).toEqual([
        { kind: "openPanel", params: { id: "demo.slash-open", component: "demo.panel", params: { source: "/x" } } },
      ])
      // Crucially: the helper goes in-process, it never calls fetch.
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      unregister()
      vi.unstubAllGlobals()
    }
  })

  it("routes notify to a showNotification UI command", async () => {
    const { bridge, posted } = makeBridge()
    const unregister = registerWorkspaceUiBridge(bridge)
    try {
      await notify("hello", "error")
      expect(posted).toEqual([{ kind: "showNotification", params: { msg: "hello", level: "error" } }])
    } finally {
      unregister()
    }
  })

  it("unregister only clears the slot if it still holds the same bridge", () => {
    const first = makeBridge().bridge
    const second = makeBridge().bridge
    const unregisterFirst = registerWorkspaceUiBridge(first)
    registerWorkspaceUiBridge(second)
    // first's unregister must not clobber second (last-registered wins).
    unregisterFirst()
    expect(getWorkspaceUiBridge()).toBe(second)
    registerWorkspaceUiBridge(second)()
  })
})
