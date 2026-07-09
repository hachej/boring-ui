export const DIAGRAM_PLUGIN_ID = "diagram"
export const DIAGRAM_PANEL_ID = "diagram.panel"

export function isDiagramPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith(".excalidraw") || lower.endsWith(".excalidraw.png")
}

export function titleForPath(path?: string): string {
  if (!path) return "Diagram"
  return path.split("/").pop() || path
}

export function saveTargetFor(path: string): string {
  if (path.toLowerCase().endsWith(".excalidraw.png")) return path.replace(/\.png$/i, "")
  return path || "untitled.excalidraw"
}

export function renderTargetFor(path: string): string {
  const source = saveTargetFor(path)
  if (source.toLowerCase().endsWith(".excalidraw")) return source.replace(/\.excalidraw$/i, ".render.png")
  return `${source}.render.png`
}
