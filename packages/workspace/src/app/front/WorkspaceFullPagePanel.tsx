"use client"

import { ErrorState } from "@hachej/boring-ui-kit"
import { useLayoutEffect, useMemo } from "react"
import { PanelRenderModeProvider } from "../../front/fullPage"
import { usePluginErrors } from "../../front/plugin"
import { useRegistry } from "../../front/registry"
import type { PaneProps } from "../../front/registry"
import {
  FULL_PAGE_PANEL_NOT_SUPPORTED,
  FULL_PAGE_PANEL_RENDER_FAILED,
  FULL_PAGE_PANEL_UNKNOWN_COMPONENT,
  type WorkspaceFullPageRouteErrorCode,
} from "./fullPageRouteErrors"

export interface WorkspaceFullPagePanelProps {
  componentId: string
  params?: Record<string, unknown>
}

function noop() {
  // noop
}

const noopDisposable = { dispose: noop }
const noopEvent = () => noopDisposable

function createFullPagePanelApi(componentId: string): PaneProps["api"] {
  return {
    id: `full-page:${componentId}`,
    title: componentId,
    isFocused: true,
    isActive: true,
    isVisible: true,
    width: 0,
    height: 0,
    location: { type: "grid", referenceGroup: undefined },
    setActive: noop,
    setTitle: (title: string) => {
      document.title = title
    },
    setSize: noop,
    close: () => {
      window.close()
    },
    moveTo: noop,
    maximize: noop,
    exitMaximized: noop,
    isMaximized: () => false,
    minimize: noop,
    onDidActiveChange: noopEvent,
    onDidVisibilityChange: noopEvent,
    onDidDimensionsChange: noopEvent,
    onDidFocusChange: noopEvent,
    onDidLocationChange: noopEvent,
    onDidParametersChange: noopEvent,
    onDidTitleChange: noopEvent,
    onDidRenamed: noopEvent,
    onWillFocus: noopEvent,
  } as unknown as PaneProps["api"]
}

function createFullPageContainerApi(): PaneProps["containerApi"] {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    minimumHeight: 0,
    maximumHeight: Infinity,
    minimumWidth: 0,
    maximumWidth: Infinity,
    activePanel: undefined,
    panels: [],
    groups: [],
    activeGroup: undefined,
    addPanel: noop,
    addGroup: noop,
    removePanel: noop,
    removeGroup: noop,
    getPanel: () => undefined,
    getGroup: () => undefined,
    moveGroupOrPanel: noop,
    fromJSON: noop,
    toJSON: () => ({}),
    clear: noop,
    focus: noop,
    layout: noop,
    onDidLayoutChange: noopEvent,
    onDidLayoutFromJSON: noopEvent,
    onDidAddPanel: noopEvent,
    onDidRemovePanel: noopEvent,
    onDidActivePanelChange: noopEvent,
    onDidAddGroup: noopEvent,
    onDidRemoveGroup: noopEvent,
    onDidActiveGroupChange: noopEvent,
    onUnhandledDragOverEvent: noopEvent,
    onDidDrop: noopEvent,
    onWillDrop: noopEvent,
    onWillDragGroup: noopEvent,
    onWillDragPanel: noopEvent,
    onDidActivePanelChange_: noopEvent,
  } as unknown as PaneProps["containerApi"]
}

function FullPagePanelError({ code, title, description }: { code: WorkspaceFullPageRouteErrorCode; title: string; description: string }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
      data-testid="full-page-error-state"
      data-full-page-error-code={code}
    >
      <ErrorState className="w-full max-w-lg" title={title} description={description} />
    </div>
  )
}

export function WorkspaceFullPagePanel({ componentId, params = {} }: WorkspaceFullPagePanelProps) {
  const registry = useRegistry()
  const { errors } = usePluginErrors()
  const panel = registry.get(componentId)
  const WrappedComponent = registry.getComponents()[componentId]

  useLayoutEffect(() => {
    document.title = panel?.title ?? componentId
  }, [componentId, panel?.title])

  const paneProps = useMemo(() => ({
    params,
    api: createFullPagePanelApi(componentId),
    containerApi: createFullPageContainerApi(),
    className: "h-full",
  }), [componentId, params])

  const panelRenderError = useMemo(() => {
    if (!panel) return null
    const pluginId = panel.pluginId ?? panel.id
    for (let index = errors.length - 1; index >= 0; index -= 1) {
      const error = errors[index]
      if (
        error.contributionKind === "panel" &&
        error.contributionId === componentId &&
        error.pluginId === pluginId
      ) {
        return error
      }
    }
    return null
  }, [componentId, errors, panel])

  if (!panel) {
    return (
      <FullPagePanelError
        code={FULL_PAGE_PANEL_UNKNOWN_COMPONENT}
        title="Unknown panel"
        description={`No full-page panel component is registered as "${componentId}".`}
      />
    )
  }

  if (!panel.supportsFullPage || !WrappedComponent) {
    return (
      <FullPagePanelError
        code={FULL_PAGE_PANEL_NOT_SUPPORTED}
        title="Panel does not support full-page mode"
        description={`Panel "${componentId}" can render in the workspace, but it has not opted into the dedicated full-page pane route.`}
      />
    )
  }

  if (panelRenderError) {
    return (
      <FullPagePanelError
        code={FULL_PAGE_PANEL_RENDER_FAILED}
        title="Panel failed to render"
        description={`Panel "${componentId}" crashed while rendering in full-page mode: ${panelRenderError.error.message}`}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PanelRenderModeProvider mode="full-page">
        <WrappedComponent {...paneProps} />
      </PanelRenderModeProvider>
    </div>
  )
}

