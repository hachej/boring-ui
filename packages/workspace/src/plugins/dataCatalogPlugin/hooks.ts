"use client"

import { useCallback, useMemo } from "react"
import type { ExplorerRow } from "../../front/components/DataExplorer"
import type { LeftTabParams } from "../../shared/plugins/types"
import { openDataCatalogVisualization } from "./openVisualization"
import type {
  DataCatalogResolvedQuery,
  DataCatalogVisualizationParams,
  DataCatalogVisualizationState,
  OpenDataCatalogVisualizationOptions,
} from "./types"

export function readDataCatalogRow(value: unknown): ExplorerRow | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as Partial<ExplorerRow>
  if (typeof row.id !== "string" || typeof row.title !== "string") return undefined
  return row as ExplorerRow
}

export function resolveDataCatalogQuery(
  params: LeftTabParams | DataCatalogVisualizationParams | undefined,
): string | undefined {
  if (!params) return undefined
  // Left-pane search is owned by workbench chrome, so it takes precedence.
  if ("searchQuery" in params && typeof params.searchQuery === "string") {
    return params.searchQuery
  }
  if ("query" in params && typeof params.query === "string") return params.query
  return undefined
}

export function resolveDataCatalogControlledQuery(
  params: LeftTabParams | DataCatalogVisualizationParams | undefined,
): DataCatalogResolvedQuery {
  const query = resolveDataCatalogQuery(params)
  return { query, controlled: query !== undefined }
}

export function resolveDataCatalogVisualizationState(
  params: DataCatalogVisualizationParams | undefined,
  fallbackTitle: string,
): DataCatalogVisualizationState {
  const row = readDataCatalogRow(params?.row)
  const query = resolveDataCatalogQuery(params) ?? row?.id
  return {
    row,
    query,
    controlled: query !== undefined,
    title: row?.title ?? fallbackTitle,
  }
}

export function useDataCatalogQuery(
  params: LeftTabParams | DataCatalogVisualizationParams | undefined,
): DataCatalogResolvedQuery {
  return useMemo(() => resolveDataCatalogControlledQuery(params), [params])
}

export function useDataCatalogVisualizationState(
  params: DataCatalogVisualizationParams | undefined,
  fallbackTitle: string,
): DataCatalogVisualizationState {
  return useMemo(
    () => resolveDataCatalogVisualizationState(params, fallbackTitle),
    [fallbackTitle, params],
  )
}

export function useDataCatalogOpenVisualization(
  options: OpenDataCatalogVisualizationOptions,
): (row: ExplorerRow) => void {
  const { catalogId, surfaceKind, title, params } = options
  return useCallback(
    (row: ExplorerRow) =>
      openDataCatalogVisualization(row, { catalogId, surfaceKind, title, params }),
    [catalogId, surfaceKind, title, params],
  )
}
