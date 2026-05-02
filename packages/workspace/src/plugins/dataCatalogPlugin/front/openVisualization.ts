import type { ExplorerRow } from "../../../front/components/DataExplorer"
import { postUiCommand } from "../../../front/bridge"
import type { OpenDataCatalogVisualizationOptions } from "./types"
import { DATA_CATALOG_ROW_SURFACE_KIND } from "../shared/constants"

function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function slugForPanelId(input: string): string {
  const slug = input
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
  return slug || "row"
}

export function dataCatalogPanelInstanceId(
  rowId: string,
  prefix = "data",
): string {
  const hash = stableHash(rowId)
  const slug = slugForPanelId(rowId)
  const safePrefix = slugForPanelId(prefix)
  const suffix = `${slug}-${hash}`
  const prefixBudget = Math.max(0, 64 - suffix.length - 1)
  const trimmedPrefix = safePrefix.slice(0, prefixBudget)
  return trimmedPrefix ? `${trimmedPrefix}-${suffix}` : suffix.slice(0, 64)
}

export function openDataCatalogVisualization(
  row: ExplorerRow,
  options: OpenDataCatalogVisualizationOptions,
): void {
  const meta: Record<string, unknown> = {
    ...(options.params ?? {}),
    // Keep routing keys authoritative even when callers pass extra params.
    row,
    catalogId: options.catalogId,
    ...(options.title ? { title: options.title } : {}),
  }
  postUiCommand({
    kind: "openSurface",
    params: {
      kind: options.surfaceKind ?? DATA_CATALOG_ROW_SURFACE_KIND,
      target: row.id,
      meta,
    },
  })
}

export function createDataCatalogOpenHandler(
  options: OpenDataCatalogVisualizationOptions,
): (row: ExplorerRow) => void {
  return (row) => openDataCatalogVisualization(row, options)
}
