"use client"

import { useCallback, useMemo } from "react"
import type { ExplorerItem } from "@hachej/boring-data-explorer/shared"
import type { LeftTabParams } from "@hachej/boring-workspace"
import { openDataCatalogVisualization } from "./openVisualization"
import type {
  DataCatalogResolvedQuery,
  DataCatalogVisualizationParams,
  DataCatalogVisualizationState,
  OpenDataCatalogVisualizationOptions,
} from "./types"

export function readDataCatalogRow(value: unknown): ExplorerItem | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as Partial<ExplorerItem>
  if (typeof row.id !== "string" || typeof row.title !== "string") return undefined
  return row as ExplorerItem
}

export function resolveDataCatalogQuery(
  params: LeftTabParams | DataCatalogVisualizationParams | undefined,
): string | undefined {
  if (!params) return undefined
  // Host chrome search, when supplied, takes precedence.
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
): (row: ExplorerItem) => void {
  const { catalogId, surfaceKind, title, params } = options
  return useCallback(
    (row: ExplorerItem) =>
      openDataCatalogVisualization(row, { catalogId, surfaceKind, title, params }),
    [catalogId, surfaceKind, title, params],
  )
}
