// @vitest-environment jsdom
import { StrictMode, useCallback, useMemo, useState } from "react"
import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceAttentionProvider } from "../../../front/attention/WorkspaceAttentionProvider"
import { AppLeftPane, createAppLeftNavigationEntries } from "../../../front/layout/plugin-tabs/AppLeftPane"
import { useAddressedFleetSessions, type WorkspaceAddressedAgentOption } from "../addressedFleetSessions"
import type {
  UseWorkspaceAgentSessions,
  WorkspaceAgentSessionsApi,
} from "../WorkspaceAgentFront"

/** Every archived-inventory load, tagged with the source that served it. */
let probes: string[] = []
const setArchived = vi.fn()

beforeEach(() => {
  probes = []
  setArchived.mockClear()
})

// A controller shaped like the real one on the two axes that matter here: it
// owns its own `archivedLoaded` state (so a replacement controller starts
// unloaded, exactly like a fresh `usePiSessions`), and its identity is stable
// between renders unless that state moves.
const useStubSessions: UseWorkspaceAgentSessions = ({ agentTypeId, sourceIdentity }) => {
  const [archivedLoaded, setArchivedLoaded] = useState(false)
  const loadArchived = useCallback(async () => {
    probes.push(sourceIdentity)
    setArchivedLoaded(true)
  }, [sourceIdentity])
  return useMemo(() => ({
    sourceIdentity,
    sessions: [{ id: `${agentTypeId}-1`, title: "Archived chat", archived: true }],
    loading: false,
    archivedLoaded,
    archivedLoading: false,
    hasMoreArchived: false,
    activeSessionId: null,
    switch: vi.fn(),
    create: () => ({ id: `${agentTypeId}-2` }),
    setArchived,
    loadArchived,
    delete: vi.fn(),
  }), [agentTypeId, archivedLoaded, loadArchived, sourceIdentity])
}

function useFleet(agents: readonly WorkspaceAddressedAgentOption[], generation: string) {
  return useAddressedFleetSessions({
    agents,
    selectedAgentTypeId: agents[0]?.agentTypeId,
    selectAgentTypeId: vi.fn(),
    discoveryLoading: agents.length === 0,
    discoveryError: undefined,
    useSessions: useStubSessions,
    requestHeaders: {},
    storageKey: "fleet",
    workspaceId: "ws",
    enabled: true,
    fleetSourceIdentity: `fleet:${generation}`,
    sourceIdentityForAgent: (agentTypeId: string) => `src:${agentTypeId}:${generation}`,
  })
}

function renderFleetApi(agents: readonly WorkspaceAddressedAgentOption[]) {
  let api: WorkspaceAgentSessionsApi | undefined
  function Harness() {
    const fleet = useFleet(agents, "g1")
    api = fleet.api
    return <>{fleet.sources}</>
  }
  render(<Harness />)
  return () => api as WorkspaceAgentSessionsApi
}

// The pane fed by the real fleet API — the composition that actually broke:
// the pane owns a one-shot probe latch, the fleet owns the capability that
// latch is about, and neither alone can be wrong safely.
function FleetPane({ agents, generation }: {
  agents: readonly WorkspaceAddressedAgentOption[]
  generation: string
}) {
  const fleet = useFleet(agents, generation)
  return (
    <WorkspaceAttentionProvider>
      {fleet.sources}
      <AppLeftPane
        appTitle="Test"
        sessions={fleet.api.sessions}
        activeSessionId={null}
        openSessionIds={[]}
        pinnedSessionIds={[]}
        onCreateSession={vi.fn()}
        navigationEntries={createAppLeftNavigationEntries({
          actions: [],
          onOpenChats: vi.fn(),
          onOpenCommandPalette: vi.fn(),
        })}
        onSwitchSession={vi.fn()}
        onOpenSessionAsPane={vi.fn()}
        onToggleSessionPinned={vi.fn()}
        archivedLoaded={fleet.api.archivedLoaded}
        archivedLoading={fleet.api.archivedLoading}
        hasMoreArchived={fleet.api.hasMoreArchived}
        onLoadArchived={fleet.api.loadArchived}
        archivedInventoryKey={fleet.api.sourceIdentity}
      />
    </WorkspaceAttentionProvider>
  )
}

describe("addressed fleet sessions archive capability", () => {
  // #1453: `every` over an empty list is true, so while Agent discovery was
  // still running (no controller published yet) the fleet claimed full archive
  // support and handed the left pane a `loadArchived` that loaded nothing.
  it("does not claim archive support before any Agent controller exists", () => {
    const api = renderFleetApi([])()
    expect(api.loadArchived).toBeUndefined()
    expect(api.setArchived).toBeUndefined()
    expect(api.archivedLoaded).toBeUndefined()
  })

  it("exposes archive and restore once every addressed Agent reports the capability", async () => {
    const api = renderFleetApi([{ agentTypeId: "alpha", label: "Alpha" }])()
    expect(api.loadArchived).toBeDefined()
    expect(api.archivedLoaded).toBe(false)
    await api.setArchived?.("alpha-1", false)
    expect(setArchived).toHaveBeenCalledWith("alpha-1", false, "alpha")
  })

  // The lifecycle that produced the bug, on one mounted pane, under
  // StrictMode: discovery (no controller) -> controllers arrive -> a
  // controller/source is lost -> a replacement publishes. Only real,
  // current controllers may be probed, and each exactly once — a lifetime
  // latch strands the replacement inventory, and an unlatched probe storms.
  it("probes each real archived inventory exactly once across loss and replacement", async () => {
    const alpha = [{ agentTypeId: "alpha", label: "Alpha" }]
    const { rerender } = render(
      <StrictMode><FleetPane agents={[]} generation="g1" /></StrictMode>,
    )
    // Discovery: nothing to probe, and nothing may be probed.
    expect(probes).toEqual([])

    rerender(<StrictMode><FleetPane agents={alpha} generation="g1" /></StrictMode>)
    await waitFor(() => expect(probes).toEqual(["src:alpha:g1"]))

    // Capability lost: the controller goes away mid-session.
    rerender(<StrictMode><FleetPane agents={[]} generation="g1" /></StrictMode>)
    await waitFor(() => expect(probes).toEqual(["src:alpha:g1"]))

    // A replacement controller returns under the SAME fleet source identity:
    // its archived pager is fresh and unloaded, so it is a new inventory and
    // must be probed on its own — the pane's latch cannot be lifetime-scoped.
    rerender(<StrictMode><FleetPane agents={alpha} generation="g1" /></StrictMode>)
    await waitFor(() => expect(probes).toEqual(["src:alpha:g1", "src:alpha:g1"]))

    // A source change is likewise a new inventory, and still exactly one probe.
    rerender(<StrictMode><FleetPane agents={alpha} generation="g2" /></StrictMode>)
    await waitFor(() => expect(probes).toEqual(["src:alpha:g1", "src:alpha:g1", "src:alpha:g2"]))

    // Steady state: no re-probe on unrelated re-renders (and no StrictMode
    // double-fire anywhere above — every step asserts an exact sequence).
    rerender(<StrictMode><FleetPane agents={alpha} generation="g2" /></StrictMode>)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(probes).toEqual(["src:alpha:g1", "src:alpha:g1", "src:alpha:g2"])
  })
})
