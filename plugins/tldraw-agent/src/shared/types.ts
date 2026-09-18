export const TLDRAW_AGENT_ERROR_CODES = {
  invalidRequest: "tldraw_agent_invalid_request",
  workspaceUnsupported: "tldraw_agent_workspace_unsupported",
  canvasUnavailable: "tldraw_agent_canvas_unavailable",
  canvasOpenFailed: "tldraw_agent_canvas_open_failed",
  editCancelled: "tldraw_agent_edit_cancelled",
  batchExpired: "tldraw_agent_batch_expired",
  leaseInvalid: "tldraw_agent_lease_invalid",
  batchInvalid: "tldraw_agent_batch_invalid",
  revisionConflict: "tldraw_agent_revision_conflict",
  unknownWriteOutcome: "tldraw_agent_unknown_write_outcome",
  commitIdConflict: "tldraw_agent_commit_id_conflict",
  internal: "tldraw_agent_internal",
} as const

export type TldrawAgentErrorCode = typeof TLDRAW_AGENT_ERROR_CODES[keyof typeof TLDRAW_AGENT_ERROR_CODES]

export interface TldrawAgentErrorEnvelope {
  error: { code: TldrawAgentErrorCode; message: string }
}

export function normalizeTldrawResourcePath(value: unknown): string {
  const raw = String(value ?? "").trim()
  if (!raw || raw.includes("\\") || raw.startsWith("/")) throw new Error("path must be a canonical relative .tldraw or .tldr path")
  const segments = raw.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("path must not contain empty, dot, or parent segments")
  if (!/\.(?:tldraw|tldr)$/i.test(raw)) throw new Error("path must be a .tldraw or .tldr file")
  return raw
}

export interface TldrawAgentParams {
  path?: string
  filesystem?: string
}

export type CanvasColor = "black" | "blue" | "green" | "orange" | "red" | "violet"
export type CanvasFill = "none" | "semi"
export type CanvasGeoShapeType = "rectangle" | "ellipse" | "diamond"
export interface CanvasGeoCreateShape {
  id: string
  type: CanvasGeoShapeType
  x: number
  y: number
  w?: number
  h?: number
  text?: string
  color?: CanvasColor
  fill?: CanvasFill
}
export interface CanvasTextCreateShape {
  id: string
  type: "text"
  x: number
  y: number
  w?: number
  text?: string
  color?: CanvasColor
}
export type CanvasCreateShape = CanvasGeoCreateShape | CanvasTextCreateShape
export type CanvasUpdateShape =
  | { id: string; target: "geo"; x?: number; y?: number; w?: number; h?: number; text?: string; color?: CanvasColor; fill?: CanvasFill }
  | { id: string; target: "text"; x?: number; y?: number; w?: number; text?: string; color?: CanvasColor }

export type CanvasAction =
  | { type: "create"; shape: CanvasCreateShape }
  | { type: "update"; shape: CanvasUpdateShape }
  | { type: "delete"; ids: string[] }
  | { type: "clear" }
  | { type: "align"; ids: string[]; axis: "x" | "y"; alignment: "start" | "center" | "end" }
  | { type: "distribute"; ids: string[]; axis: "x" | "y" }

export interface PendingCanvasBatch {
  id: string
  path: string
  filesystem: "user"
  actions: CanvasAction[]
}
