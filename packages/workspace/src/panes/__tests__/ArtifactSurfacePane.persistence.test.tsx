import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, act } from "@testing-library/react"
import { ArtifactSurfacePane } from "../ArtifactSurfacePane"
import { RegistryProvider } from "../../front/registry"
import { PanelRegistry } from "../../front/registry/PanelRegistry"
import { CommandRegistry } from "../../front/registry/CommandRegistry"
import { bindStore } from "../../front/store/selectors"
import { createWorkspaceStore } from "../../front/store"
import type { SerializedLayout } from "../../front/dock"

// DockviewShell mock — capture the props ArtifactSurfacePane passes through
// so we can assert what was hydrated from localStorage and synthesize layout
// changes without depending on dockview's internal onDidLayoutChange debounce
// (which doesn't fire reliably under jsdom anyway).
let capturedProps: {
  persistedLayout?: SerializedLayout
  onLayoutChange?: (layout: SerializedLayout) => void
} = {}
let mountCount = 0

vi.mock("../../front/dock", async () => {
  const actual = await vi.importActual<typeof import("../../front/dock")>("../../front/dock")
  return {
    ...actual,
    DockviewShell: (props: {
      persistedLayout?: SerializedLayout
      onLayoutChange?: (layout: SerializedLayout) => void
    }) => {
      mountCount += 1
      capturedProps = {
        persistedLayout: props.persistedLayout,
        onLayoutChange: props.onLayoutChange,
      }
      return <div data-testid="mock-dock-shell" />
    },
  }
})

function DummyPanel() {
  return <div>panel</div>
}

function renderPane(ui: React.ReactElement) {
  const store = createWorkspaceStore()
  bindStore(store)
  const panelRegistry = new PanelRegistry()
  panelRegistry.register("empty", { title: "empty", component: DummyPanel })
  const commandRegistry = new CommandRegistry()
  return render(
    <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
      {ui}
    </RegistryProvider>,
  )
}

const KEY = "test:surface-layout"

// Build a SerializedLayout-shaped object whose panels all reference an
// allowedPanels component, since validation drops layouts with unknown
// contentComponents.
function buildLayout(
  panels: Array<{ id: string; component: string }> = [{ id: "p1", component: "empty" }],
): SerializedLayout {
  const panelMap: Record<string, unknown> = {}
  for (const p of panels) {
    panelMap[p.id] = { id: p.id, contentComponent: p.component }
  }
  return {
    activeGroup: panels[0]?.id,
    grid: {} as Record<string, unknown>,
    panels: panelMap,
  } as unknown as SerializedLayout
}

function envelope(layout: SerializedLayout, v = 1): string {
  return JSON.stringify({ v, layout })
}

describe("ArtifactSurfacePane — layout persistence", () => {
  beforeEach(() => {
    capturedProps = {}
    mountCount = 0
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("hydrates persistedLayout from localStorage on mount", () => {
    const layout = buildLayout()
    localStorage.setItem(KEY, envelope(layout))
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(capturedProps.persistedLayout).toEqual(layout)
  })

  it("returns undefined persistedLayout when localStorage is empty", () => {
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(capturedProps.persistedLayout).toBeUndefined()
  })

  it("writes layout changes to localStorage wrapped in versioned envelope", () => {
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(capturedProps.onLayoutChange).toBeTypeOf("function")
    const layout = buildLayout()
    act(() => {
      capturedProps.onLayoutChange?.(layout)
    })
    const raw = localStorage.getItem(KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed).toEqual({ v: 1, layout })
  })

  it("round-trips: a written layout is restored on next mount", () => {
    const { unmount } = renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    const layout = buildLayout()
    act(() => {
      capturedProps.onLayoutChange?.(layout)
    })
    unmount()
    capturedProps = {}
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(capturedProps.persistedLayout).toEqual(layout)
  })

  it("ignores stale localStorage entries that fail to JSON.parse", () => {
    localStorage.setItem(KEY, "{not-json")
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(capturedProps.persistedLayout).toBeUndefined()
  })

  it("ignores payloads without a versioned envelope (raw layout from old code)", () => {
    // Pre-envelope code wrote raw SerializedLayout. After the upgrade those
    // entries can't be trusted to match the current shape — drop silently
    // rather than risk a fromJSON throw.
    localStorage.setItem(KEY, JSON.stringify(buildLayout()))
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(capturedProps.persistedLayout).toBeUndefined()
  })

  it("rejects payloads with a mismatched envelope version", () => {
    localStorage.setItem(KEY, envelope(buildLayout(), 2))
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(capturedProps.persistedLayout).toBeUndefined()
  })

  it("drops the layout when any panel's contentComponent isn't in allowedPanels", () => {
    // A saved tab whose component was removed (or filtered out of this
    // shell) would silently render an empty pane via dockview. Reject the
    // whole layout so the user gets a fresh shell instead of a wedged one.
    const layout = buildLayout([
      { id: "p1", component: "empty" },
      { id: "p2", component: "removed-component" },
    ])
    localStorage.setItem(KEY, envelope(layout))
    renderPane(
      <ArtifactSurfacePane storageKey={KEY} allowedPanels={["empty"]} />,
    )
    expect(capturedProps.persistedLayout).toBeUndefined()
  })

  it("explicit persistedLayout prop wins over localStorage", () => {
    const stored = buildLayout([{ id: "stored", component: "empty" }])
    const explicit = buildLayout([{ id: "explicit", component: "empty" }])
    localStorage.setItem(KEY, envelope(stored))
    renderPane(
      <ArtifactSurfacePane storageKey={KEY} persistedLayout={explicit} />,
    )
    expect(capturedProps.persistedLayout).toEqual(explicit)
  })

  it("explicit onLayoutChange prevents writes to localStorage", () => {
    const onLayoutChange = vi.fn()
    const layout = buildLayout()
    renderPane(
      <ArtifactSurfacePane storageKey={KEY} onLayoutChange={onLayoutChange} />,
    )
    act(() => {
      capturedProps.onLayoutChange?.(layout)
    })
    expect(onLayoutChange).toHaveBeenCalledWith(layout)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it("does not hydrate from localStorage when caller supplies onLayoutChange", () => {
    localStorage.setItem(KEY, envelope(buildLayout()))
    renderPane(
      <ArtifactSurfacePane storageKey={KEY} onLayoutChange={() => {}} />,
    )
    expect(capturedProps.persistedLayout).toBeUndefined()
  })

  it("survives localStorage write failures (e.g. quota / disabled)", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError")
      })
    renderPane(<ArtifactSurfacePane storageKey={KEY} />)
    expect(() => {
      act(() => {
        capturedProps.onLayoutChange?.(buildLayout())
      })
    }).not.toThrow()
    setItemSpy.mockRestore()
  })

  it("survives localStorage read failures (e.g. SecurityError)", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError")
      })
    expect(() =>
      renderPane(<ArtifactSurfacePane storageKey={KEY} />),
    ).not.toThrow()
    expect(capturedProps.persistedLayout).toBeUndefined()
    getItemSpy.mockRestore()
  })

  it("uses the default storageKey when not specified", () => {
    // The default key is an internal detail of ArtifactSurfacePane — write
    // under it directly to confirm the prop default points at the same
    // bucket the component reads from on mount.
    localStorage.setItem("boring-ui-v2:surface", envelope(buildLayout()))
    renderPane(<ArtifactSurfacePane />)
    expect(capturedProps.persistedLayout).toBeDefined()
  })

  // Codex review #1: storageKey is read once via lazy useState, so a key
  // change after mount left hydration stuck on the original key while writes
  // followed the new one. Now keyed via useMemo + DockviewShell remount —
  // changing storageKey hydrates from the new bucket.
  it("re-hydrates from the new key when storageKey changes after mount", () => {
    const KEY_A = "test:key-a"
    const KEY_B = "test:key-b"
    const layoutA = buildLayout([{ id: "a", component: "empty" }])
    const layoutB = buildLayout([{ id: "b", component: "empty" }])
    localStorage.setItem(KEY_A, envelope(layoutA))
    localStorage.setItem(KEY_B, envelope(layoutB))
    const { rerender } = renderPane(<ArtifactSurfacePane storageKey={KEY_A} />)
    expect(capturedProps.persistedLayout).toEqual(layoutA)
    rerender(
      <RegistryProvider
        panelRegistry={(() => {
          const r = new PanelRegistry()
          r.register("empty", { title: "empty", component: DummyPanel })
          return r
        })()}
        commandRegistry={new CommandRegistry()}
      >
        <ArtifactSurfacePane storageKey={KEY_B} />
      </RegistryProvider>,
    )
    expect(capturedProps.persistedLayout).toEqual(layoutB)
    // The remount is the mechanism: confirm DockviewShell mounted twice, so
    // dockview itself ran fromJSON on the new payload (vs. silently keeping
    // the old fromJSON state).
    expect(mountCount).toBeGreaterThanOrEqual(2)
  })

  it("does not write the new layout under the OLD storageKey after a key change", () => {
    // Regression: before the remount, layout changes after a storageKey swap
    // could land under the new key with the OLD layout — leaking data
    // between buckets. Verify writes go to the new key only.
    const KEY_A = "test:key-a"
    const KEY_B = "test:key-b"
    const { rerender } = renderPane(<ArtifactSurfacePane storageKey={KEY_A} />)
    rerender(
      <RegistryProvider
        panelRegistry={(() => {
          const r = new PanelRegistry()
          r.register("empty", { title: "empty", component: DummyPanel })
          return r
        })()}
        commandRegistry={new CommandRegistry()}
      >
        <ArtifactSurfacePane storageKey={KEY_B} />
      </RegistryProvider>,
    )
    act(() => {
      capturedProps.onLayoutChange?.(buildLayout())
    })
    expect(localStorage.getItem(KEY_A)).toBeNull()
    expect(localStorage.getItem(KEY_B)).not.toBeNull()
  })
})
