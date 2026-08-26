import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createSaasThreadSession,
  explorerVisibleForCenter,
  openSaasThread,
  openSaasView,
  openSaasViewById,
  readSaasThreadSessionId,
  shellRef,
  storeSaasThreadSessionId,
  type CenterState,
} from "./saasShell"
import { SAAS_VIEWS } from "./SaasSpikeFixtures"

describe("explorer presence is derived from the centre, not a separate toggle", () => {
  it("is true only in dock mode", () => {
    expect(explorerVisibleForCenter({ mode: "dock" })).toBe(true)
    expect(explorerVisibleForCenter({ mode: "page", page: { kind: "inbox" } })).toBe(false)
    expect(explorerVisibleForCenter({ mode: "page", page: { kind: "thread", threadId: "t1" } })).toBe(false)
    expect(explorerVisibleForCenter({ mode: "page", page: { kind: "agent", agentId: "a1" } })).toBe(false)
    expect(explorerVisibleForCenter({ mode: "page", page: { kind: "automations" } })).toBe(false)
    expect(explorerVisibleForCenter({ mode: "page", page: { kind: "archived" } })).toBe(false)
  })

  // The owner's exact repro: Library -> Files (tree shows) -> a thread under
  // Work -> the tree must be gone -> back to Companies -> its explorer is
  // back. This drives the real nav openers (`openSaasView`/`openSaasThread`)
  // through `shellRef.setCenter`, the same seam the shell itself reads, so it
  // exercises the actual state transition rather than re-deriving it by hand.
  it("clears the explorer when a thread under Work is opened, and restores it back in the Library", () => {
    const states: CenterState[] = []
    shellRef.setCenter = (center) => { states.push(center) }
    shellRef.setView = () => {}
    try {
      const filesView = SAAS_VIEWS.find((view) => view.id === "view-files")
      openSaasView(filesView)
      expect(explorerVisibleForCenter(states.at(-1)!)).toBe(true)

      openSaasThread("acme-diligence")
      expect(explorerVisibleForCenter(states.at(-1)!)).toBe(false)
      expect(states.at(-1)).toEqual({ mode: "page", page: { kind: "thread", threadId: "acme-diligence" } })

      openSaasViewById("view-companies")
      expect(explorerVisibleForCenter(states.at(-1)!)).toBe(true)
    } finally {
      shellRef.setCenter = null
      shellRef.setView = null
    }
  })
})

describe("real thread sessions", () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("remembers a thread's real session id across reads", () => {
    expect(readSaasThreadSessionId("acme-diligence")).toBeNull()
    storeSaasThreadSessionId("acme-diligence", "sess-123")
    expect(readSaasThreadSessionId("acme-diligence")).toBe("sess-123")
    // A second thread's session does not clobber the first.
    storeSaasThreadSessionId("other-thread", "sess-456")
    expect(readSaasThreadSessionId("acme-diligence")).toBe("sess-123")
    expect(readSaasThreadSessionId("other-thread")).toBe("sess-456")
  })

  it("creates a session against the live agent API and returns its id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sessionId: "sess-789", agentTypeId: "builder" }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const sessionId = await createSaasThreadSession("builder", "Workspace", "Grow my audience")
    expect(sessionId).toBe("sess-789")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agents/builder/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-boring-workspace-id": "Workspace" }),
      }),
    )
  })

  it("throws honestly when the create request fails, rather than fabricating a session id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    await expect(createSaasThreadSession("builder", "Workspace", "New chat")).rejects.toThrow("503")
  })
})
