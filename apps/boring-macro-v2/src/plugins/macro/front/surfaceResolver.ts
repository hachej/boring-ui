import type { WorkspaceFrontPlugin } from "@boring/workspace"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "@boring/workspace"
import {
  MACRO_CHART_PANEL_ID,
  MACRO_DECK_PANEL_ID,
  MACRO_DECK_SURFACE_RESOLVER_ID,
  MACRO_OPEN_SERIES_SURFACE_KIND,
  MACRO_SERIES_SURFACE_RESOLVER_ID,
} from "../shared/constants"
import type { MacroSeriesSurfaceMeta } from "../shared/types"

function basename(path: string): string {
  return path.split("/").pop() ?? path
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

function isDeckMarkdownPath(path: string): boolean {
  const normalized = normalizePath(path)
  if (!normalized.startsWith("deck/") || !normalized.endsWith(".md")) return false
  const rest = normalized.slice("deck/".length)
  return rest.length > 0 && !rest.includes("/")
}

export const macroSurfaceOutputs: NonNullable<WorkspaceFrontPlugin["outputs"]> = [
  {
    type: "surface-resolver",
    resolver: {
      id: MACRO_SERIES_SURFACE_RESOLVER_ID,
      source: "app",
      resolve(request) {
        if (request.kind !== MACRO_OPEN_SERIES_SURFACE_KIND) return undefined
        const seriesId = request.target.trim()
        if (!seriesId) return undefined
        const meta = request.meta as MacroSeriesSurfaceMeta | undefined
        const title =
          typeof meta?.title === "string" && meta.title.length > 0
            ? meta.title
            : seriesId
        return {
          id: `chart:${seriesId}`,
          component: MACRO_CHART_PANEL_ID,
          title,
          params: { seriesId },
          score: 0,
        }
      },
    },
  },
  {
    type: "surface-resolver",
    resolver: {
      id: MACRO_DECK_SURFACE_RESOLVER_ID,
      source: "app",
      resolve(request) {
        if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return undefined
        const path = normalizePath(request.target)
        if (!isDeckMarkdownPath(path)) return undefined
        return {
          id: `file:${path}`,
          component: MACRO_DECK_PANEL_ID,
          title: basename(path),
          params: { path },
          score: 10,
        }
      },
    },
  },
]
