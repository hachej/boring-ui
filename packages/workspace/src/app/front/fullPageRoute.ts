import {
  FULL_PAGE_PANEL_INVALID_PARAMS_JSON,
  FULL_PAGE_PANEL_MISSING_COMPONENT,
  FULL_PAGE_PANEL_PARAMS_NOT_OBJECT,
  type WorkspaceFullPageRouteErrorCode,
} from "./fullPageRouteErrors"

export interface ParsedFullPagePanelLocation {
  componentId: string | null
  params: Record<string, unknown>
  error?: {
    code: WorkspaceFullPageRouteErrorCode
    message: string
  }
}

export function parseFullPagePanelLocation(search: string): ParsedFullPagePanelLocation {
  const query = new URLSearchParams(search)
  const componentId = query.get("component")?.trim() ?? ""
  if (!componentId) {
    return {
      componentId: null,
      params: {},
      error: {
        code: FULL_PAGE_PANEL_MISSING_COMPONENT,
        message: "Missing full-page panel component id.",
      },
    }
  }

  const rawParams = query.get("params")
  if (!rawParams) {
    return { componentId, params: {} }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawParams)
  } catch {
    return {
      componentId: null,
      params: {},
      error: {
        code: FULL_PAGE_PANEL_INVALID_PARAMS_JSON,
        message: "Invalid full-page panel params JSON.",
      },
    }
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    return {
      componentId: null,
      params: {},
      error: {
        code: FULL_PAGE_PANEL_PARAMS_NOT_OBJECT,
        message: "Full-page panel params must be a JSON object.",
      },
    }
  }

  return { componentId, params: parsed as Record<string, unknown> }
}
