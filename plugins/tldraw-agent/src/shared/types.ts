export interface TldrawAgentParams {
  path?: string
  filesystem?: string
}

export interface CanvasShapeInput {
  id?: string
  type?: "rectangle" | "ellipse" | "diamond" | "text"
  x?: number
  y?: number
  w?: number
  h?: number
  text?: string
  color?: "black" | "blue" | "green" | "orange" | "red" | "violet"
  fill?: "none" | "semi"
}

export interface CanvasAction {
  type: "create" | "update" | "delete" | "clear" | "align" | "distribute"
  shape?: CanvasShapeInput & { props?: Record<string, unknown> }
  shapes?: CanvasShapeInput[]
  ids?: string[]
  axis?: "x" | "y"
  alignment?: "start" | "center" | "end"
}

export interface PendingCanvasBatch {
  id: string
  path: string
  actions: CanvasAction[]
}
