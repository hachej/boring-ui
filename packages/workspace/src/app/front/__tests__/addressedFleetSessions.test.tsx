// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useAddressedFleetSessions } from "../addressedFleetSessions"
import type {
  UseWorkspaceAgentSessions,
  WorkspaceAgentSessionsApi,
} from "../WorkspaceAgentFront"

const loadArchived = vi.fn()
const setArchived = vi.fn()

const useSessions: UseWorkspaceAgentSessions = ({ agentTypeId, sourceIdentity }) => ({
  sourceIdentity,
  sessions: [{ id: `${agentTypeId}-1`, title: "chat", archived: true }],
  loading: false,
  archivedLoaded: false,
  archivedLoading: false,
  hasMoreArchived: false,
  activeSessionId: null,
  switch: vi.fn(),
  create: () => ({ id: `${agentTypeId}-2` }),
  setArchived,
  loadArchived,
  delete: vi.fn(),
})

function renderFleet(agents: Array<{ agentTypeId: string; label: string }>) {
  let api: WorkspaceAgentSessionsApi | undefined
  function Harness() {
    const fleet = useAddressedFleetSessions({
      agents,
      selectedAgentTypeId: agents[0]?.agentTypeId,
      selectAgentTypeId: vi.fn(),
      discoveryLoading: agents.length === 0,
      discoveryError: undefined,
      useSessions,
      requestHeaders: {},
      storageKey: "fleet",
      workspaceId: "ws",
      enabled: true,
      fleetSourceIdentity: "fleet",
      sourceIdentityForAgent: (agentTypeId: string) => `src:${agentTypeId}`,
    })
    api = fleet.api
    return <>{fleet.sources}</>
  }
  render(<Harness />)
  return () => api as WorkspaceAgentSessionsApi
}

describe("addressed fleet sessions archive capability", () => {
  // #1453: `every` over an empty list is true, so while Agent discovery was
  // still running (no controller published yet) the fleet claimed full archive
  // support and handed the left pane a `loadArchived` that loaded nothing. The
  // pane probes for archived chats exactly once, latched on that no-op, and
  // never asked again — leaving the Archived section, the only way back from
  // Archive, permanently hidden.
  it("does not claim archive support before any Agent controller exists", () => {
    const api = renderFleet([])()
    expect(api.loadArchived).toBeUndefined()
    expect(api.setArchived).toBeUndefined()
    expect(api.archivedLoaded).toBeUndefined()
  })

  it("exposes archive and restore once every addressed Agent reports the capability", async () => {
    const api = renderFleet([{ agentTypeId: "alpha", label: "Alpha" }])()
    expect(api.loadArchived).toBeDefined()
    expect(api.archivedLoaded).toBe(false)
    await api.setArchived?.("alpha-1", false)
    expect(setArchived).toHaveBeenCalledWith("alpha-1", false, "alpha")
  })
})
