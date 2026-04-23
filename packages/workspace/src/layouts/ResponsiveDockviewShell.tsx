import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PinIcon } from "lucide-react"
import { DockviewShell } from "../dock"
import type { LayoutConfig } from "../dock"
import { useRegistry } from "../registry"
import { useSetSidebar, useSidebarState } from "../store/selectors"
import { cn } from "../lib/utils"
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui"
import {
  useResponsiveSidebarCollapse,
  useViewportBreakpoint,
} from "../hooks"

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

interface ResponsiveDockviewShellProps {
  layout: LayoutConfig
  className?: string
}

function removeSidebarGroup(layout: LayoutConfig): LayoutConfig {
  return {
    ...layout,
    groups: layout.groups.filter((group) => group.id !== "sidebar"),
  }
}

export function ResponsiveDockviewShell({
  layout,
  className,
}: ResponsiveDockviewShellProps) {
  const registry = useRegistry()
  const sidebarState = useSidebarState()
  const setSidebar = useSetSidebar()
  const isMobile = useViewportBreakpoint(MOBILE_BREAKPOINT)
  const isTablet = useViewportBreakpoint(TABLET_BREAKPOINT)
  const isTabletOnly = isTablet && !isMobile

  const sidebarGroup = useMemo(
    () => layout.groups.find((group) => group.id === "sidebar" && group.panel),
    [layout],
  )
  const sidebarPanelId = sidebarGroup?.panel
  const hasSidebar = Boolean(sidebarPanelId)

  const markManualSidebarPreference = useResponsiveSidebarCollapse({
    isNarrowViewport: hasSidebar && isTablet,
    isCollapsed: sidebarState.collapsed,
    setCollapsed: (collapsed) => setSidebar({ collapsed }),
  })

  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    if (!hasSidebar || (!isMobile && !isTabletOnly)) {
      setSheetOpen(false)
    }
  }, [hasSidebar, isMobile, isTabletOnly])

  const showOverlaySidebar = hasSidebar && (isMobile || (isTabletOnly && sidebarState.collapsed))
  const showInlineSidebar = hasSidebar && !isMobile && (!isTabletOnly || !sidebarState.collapsed)

  const effectiveLayout = useMemo(
    () => (showInlineSidebar ? layout : removeSidebarGroup(layout)),
    [showInlineSidebar, layout],
  )
  const shellKey = useMemo(() => {
    const composition = showInlineSidebar ? "inline-sidebar" : "overlay-sidebar"
    const groupsKey = effectiveLayout.groups.map((group) => group.id).join(",")
    return `${effectiveLayout.version}:${composition}:${groupsKey}`
  }, [effectiveLayout, showInlineSidebar])

  const components = useMemo(() => registry.getComponents(), [registry])
  const SidebarPanel = sidebarPanelId ? components[sidebarPanelId] : null
  const sidebarTitle = sidebarPanelId
    ? (registry.get(sidebarPanelId)?.title ?? "Sidebar")
    : "Sidebar"

  const handleOpenOverlay = useCallback(() => {
    setSheetOpen(true)
  }, [])

  const handlePinOpen = useCallback(() => {
    markManualSidebarPreference()
    setSidebar({ collapsed: false })
    setSheetOpen(false)
  }, [markManualSidebarPreference, setSidebar])

  const handleCollapseToRail = useCallback(() => {
    markManualSidebarPreference()
    setSidebar({ collapsed: true })
    setSheetOpen(false)
  }, [markManualSidebarPreference, setSidebar])

  const handleOverlayContentClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target.closest("[role='treeitem']")) {
        setSheetOpen(false)
      }
    },
    [],
  )

  return (
    <div className="relative h-full w-full">
      {isTabletOnly && hasSidebar && sidebarState.collapsed && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-10 border-r border-border bg-background/95"
          aria-hidden="true"
        />
      )}

      {showOverlaySidebar && (
        <div
          className={cn(
            "absolute z-30",
            isMobile ? "left-2 top-2" : "left-1 top-2",
          )}
        >
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={handleOpenOverlay}
            aria-label={isMobile ? "Open sidebar menu" : "Open collapsed sidebar"}
          >
            {isMobile ? <MenuIcon className="h-4 w-4" /> : <PanelLeftOpenIcon className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {isTabletOnly && hasSidebar && !sidebarState.collapsed && (
        <div className="absolute left-2 top-2 z-30">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={handleCollapseToRail}
            aria-label="Collapse sidebar"
          >
            <PanelLeftCloseIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      <DockviewShell
        key={shellKey}
        layout={effectiveLayout}
        className={cn(
          className,
          isTabletOnly && hasSidebar && sidebarState.collapsed && "pl-10",
        )}
      />

      {showOverlaySidebar && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="left"
            className="w-[85vw] max-w-sm p-0"
          >
            <SheetHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3">
              <div>
                <SheetTitle>{sidebarTitle}</SheetTitle>
                <SheetDescription className="sr-only">
                  Responsive sidebar panel
                </SheetDescription>
              </div>
              {isTabletOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePinOpen}
                  aria-label="Pin sidebar open"
                >
                  <PinIcon className="h-4 w-4" />
                  Pin
                </Button>
              )}
            </SheetHeader>
            <div
              className="h-full min-h-0 overflow-auto"
              onClickCapture={handleOverlayContentClickCapture}
            >
              {SidebarPanel ? (
                <Suspense fallback={<SidebarPanelFallback />}>
                  <SidebarPanel />
                </Suspense>
              ) : (
                <SidebarPanelFallback />
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function SidebarPanelFallback() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
      Loading sidebar...
    </div>
  )
}
