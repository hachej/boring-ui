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
