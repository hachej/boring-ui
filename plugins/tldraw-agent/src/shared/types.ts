export interface TldrawAgentParams {
  path?: string
  filesystem?: string
}

export type CanvasColor = "black" | "blue" | "green" | "orange" | "red" | "violet"
export type CanvasFill = "none" | "semi"
export type CanvasShapeType = "rectangle" | "ellipse" | "diamond" | "text"

export interface CanvasCreateShape {
  id: string
  type: CanvasShapeType
  x: number
  y: number
  w?: number
  h?: number
  text?: string
  color?: CanvasColor
  fill?: CanvasFill
}

export interface CanvasUpdateShape {
  id: string
  x?: number
  y?: number
  w?: number
  h?: number
  text?: string
  color?: CanvasColor
  fill?: CanvasFill
}

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
