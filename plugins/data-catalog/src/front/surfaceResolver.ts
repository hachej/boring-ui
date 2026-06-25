import type { ExplorerItem } from "@hachej/boring-data-explorer/shared"
import type { BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"
import { DATA_CATALOG_ROW_SURFACE_KIND } from "../shared/constants"
import { dataCatalogPanelInstanceId } from "./openVisualization"

export interface CreateDataCatalogSurfaceResolverOptions {
  id: string
  catalogId: string
  visualizationPanelId: string
  visualizationTitle: string
  panelIdPrefix?: string
  surfaceKind?: string
  surfaceResolverId?: string
  source?: string
}

function isExplorerItem(value: unknown): value is ExplorerItem {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<ExplorerItem>
  return typeof row.id === "string" && typeof row.title === "string"
}

function stringMeta(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function createDataCatalogSurfaceResolver(
  options: CreateDataCatalogSurfaceResolverOptions,
): BoringFrontSurfaceResolverRegistration {
  const kind = options.surfaceKind ?? DATA_CATALOG_ROW_SURFACE_KIND
  const panelIdPrefix = options.panelIdPrefix ?? options.id

  return {
    id: options.surfaceResolverId ?? `${options.id}-row`,
    kind,
    title: "Open data catalog row",
    description: "Open or focus a data catalog row using the host catalog resolver.",
    targetHint: "catalog row id or query string",
    examples: [{ target: "orders_daily" }],
    source: options.source,
    resolve(request) {
      if (request.kind !== kind) return undefined

      const meta = request.meta ?? {}
      const catalogId = stringMeta(meta, "catalogId")
      if (catalogId && catalogId !== options.catalogId) return undefined
      const row = isExplorerItem(meta.row) ? meta.row : undefined
      const {
        catalogId: _catalogId,
        row: _row,
        title: _title,
        ...extraParams
      } = meta

      return {
        id: dataCatalogPanelInstanceId(request.target, panelIdPrefix),
        component: options.visualizationPanelId,
        title: stringMeta(meta, "title") ?? row?.title ?? options.visualizationTitle,
        params: {
          ...extraParams,
          ...(row ? { row } : { query: request.target }),
        },
        score: 0,
      }
    },
  }
}
