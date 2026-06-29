import { useEffect, useRef, useSyncExternalStore } from "react"
import { useRegistry, useSurfaceResolverRegistry } from "../../front/registry"
import { surfaceResolverDescriptor } from "../../shared/types/surface"
import type { SurfaceShellSnapshot } from "../../front/chrome/artifact-surface/SurfaceShell"

function uiEndpointBase(endpoint: string | null | undefined): string {
  if (!endpoint) return "/api/v1/ui"
  const normalized = endpoint.replace(/\/$/, "")
  const suffix = "/api/v1/ui"
  if (normalized.endsWith(suffix)) return normalized
  return `${normalized}${suffix}`
}

function uiStateEndpointUrl(endpoint: string | null | undefined): string {
  return `${uiEndpointBase(endpoint)}/state`
}

function activeFileFromSnapshot(snapshot: SurfaceShellSnapshot): string | null {
  const active = snapshot.openTabs.find((tab) => tab.id === snapshot.activeTab)
  const path = active?.params?.path
  return typeof path === "string" ? path : null
}

export function WorkspaceUiStateSync({
  bridgeEndpoint,
  requestHeaders,
  navOpen,
  surfaceOpen,
  surfaceReady,
  snapshot,
}: {
  bridgeEndpoint?: string | null
  requestHeaders: Record<string, string>
  navOpen: boolean
  surfaceOpen: boolean
  surfaceReady: boolean
  snapshot: SurfaceShellSnapshot
}) {
  const panelRegistry = useRegistry()
  const surfaceResolverRegistry = useSurfaceResolverRegistry()
  const panelRegistrySnapshot = useSyncExternalStore(
    panelRegistry.subscribe,
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot,
  )
  const surfaceResolverSnapshot = useSyncExternalStore(
    surfaceResolverRegistry.subscribe,
    surfaceResolverRegistry.getSnapshot,
    surfaceResolverRegistry.getSnapshot,
  )
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (bridgeEndpoint === null) return
    // Do not publish a placeholder empty tab snapshot while the workbench
    // is mounted/opening but Dockview has not called onReady yet. That
    // replace-style PUT would clobber the bridge's last known openTabs and
    // make agent verification think every tab disappeared.
    if (surfaceOpen && !surfaceReady) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const state = {
      v: 1,
      drawerOpen: navOpen,
      workbenchOpen: surfaceOpen,
      openTabs: snapshot.openTabs,
      activeTab: snapshot.activeTab,
      activeFile: activeFileFromSnapshot(snapshot),
      availablePanels: panelRegistrySnapshot.map((panel) => panel.id),
      availableSurfaces: surfaceResolverSnapshot.flatMap((surface) => {
        const descriptor = surfaceResolverDescriptor(surface)
        return descriptor ? [descriptor] : []
      }),
    }

    void fetch(uiStateEndpointUrl(bridgeEndpoint), {
      method: "PUT",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ state, causedBy: "user" }),
      signal: controller.signal,
    }).catch(() => {
      // UI state is advisory for the agent; command delivery still works.
    })

    return () => {
      controller.abort()
    }
  }, [bridgeEndpoint, navOpen, panelRegistrySnapshot, requestHeaders, snapshot, surfaceOpen, surfaceReady, surfaceResolverSnapshot])

  return null
}
