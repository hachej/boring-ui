import type { DockviewApi } from "dockview-react"

export const WORKBENCH_PREVIEW_PARAM = "__workbenchPreview" as const

export function isWorkbenchPreviewParams(params: unknown): boolean {
  return Boolean(
    params &&
    typeof params === "object" &&
    (params as Record<string, unknown>)[WORKBENCH_PREVIEW_PARAM] === true,
  )
}

export function workbenchPreviewParams(params?: Record<string, unknown>): Record<string, unknown> {
  return { ...(params ?? {}), [WORKBENCH_PREVIEW_PARAM]: true }
}

export function pinnedWorkbenchParams(params?: Record<string, unknown>): Record<string, unknown> {
  return { ...(params ?? {}), [WORKBENCH_PREVIEW_PARAM]: false }
}

export function closeWorkbenchPreview(api: DockviewApi): void {
  api.panels.find((panel) => isWorkbenchPreviewParams(panel.params))?.api.close()
}
