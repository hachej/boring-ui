"use client"

import { BarChart3, Database } from "lucide-react"
import { definePanel } from "../../front/registry/types"
import { PanelChrome } from "../../front/dock"
import { DataExplorer } from "../../front/components/DataExplorer"
import { defineFrontPlugin } from "../../shared/plugins/defineFrontPlugin"
import type {
  CatalogConfig,
  LeftTabParams,
  PluginOutput,
} from "../../shared/plugins/types"
import type { WorkspaceFrontPlugin } from "../../shared/plugins/defineFrontPlugin"
import type { PaneProps, PanelConfig } from "../../front/registry/types"
import {
  DATA_CATALOG_PLUGIN_ID,
  DATA_CATALOG_ROW_SURFACE_KIND,
} from "./constants"
import { createDataCatalogOpenHandler } from "./openVisualization"
import { createDataCatalogSurfaceResolver } from "./surfaceResolver"
import {
  useDataCatalogQuery,
  useDataCatalogVisualizationState,
} from "./hooks"
import type {
  CreateDataCatalogOutputsOptions,
  CreateDataCatalogPluginOptions,
  DataCatalogVisualizationParams,
} from "./types"

export {
  DATA_CATALOG_DEFAULT_TOOL_NAME,
  DATA_CATALOG_PLUGIN_ID,
  DATA_CATALOG_ROW_SURFACE_KIND,
} from "./constants"
export {
  createDataCatalogOpenHandler,
  dataCatalogPanelInstanceId,
  openDataCatalogVisualization,
} from "./openVisualization"
export { createDataCatalogSurfaceResolver } from "./surfaceResolver"
export {
  readDataCatalogRow,
  resolveDataCatalogControlledQuery,
  resolveDataCatalogQuery,
  resolveDataCatalogVisualizationState,
  useDataCatalogOpenVisualization,
  useDataCatalogQuery,
  useDataCatalogVisualizationState,
} from "./hooks"
export type {
  CreateDataCatalogSurfaceResolverOptions,
} from "./surfaceResolver"
export type {
  CreateDataCatalogOutputsOptions,
  CreateDataCatalogPluginOptions,
  DataCatalogResolvedQuery,
  DataExplorerProps,
  DataCatalogVisualizationParams,
  DataCatalogVisualizationState,
  OpenDataCatalogVisualizationOptions,
} from "./types"

export function createDataCatalogOutputs(
  options: CreateDataCatalogOutputsOptions,
): PluginOutput[] {
  const id = options.id ?? DATA_CATALOG_PLUGIN_ID
  const label = options.label ?? "Data"
  const catalogId = options.catalogId ?? id
  const catalogLabel = options.catalogLabel ?? label
  const leftTabId = options.leftTabId ?? `${id}-tab`
  const leftTabTitle = options.leftTabTitle ?? label
  const visualizationPanelId = options.visualizationPanelId ?? `${id}-visualization`
  const visualizationTitle = options.visualizationTitle ?? `${label} View`
  const surfaceKind = options.surfaceKind ?? DATA_CATALOG_ROW_SURFACE_KIND
  const source = options.source ?? "app"
  const includeVisualizationPanel = options.includeVisualizationPanel ?? true
  const includeLeftTab = options.includeLeftTab ?? true
  const includeCatalog = options.includeCatalog ?? true
  const includeSurfaceResolver =
    options.includeSurfaceResolver ?? (includeVisualizationPanel && !options.onSelect)
  const emptyState = options.emptyState ?? "No data found"
  const searchPlaceholder = options.searchPlaceholder ?? `Search ${label.toLowerCase()}...`
  const onSelect =
    options.onSelect ??
    (includeVisualizationPanel
      ? createDataCatalogOpenHandler({
          catalogId,
          surfaceKind,
        })
      : () => {})

  function DataCatalogLeftTab({ params, className }: PaneProps<LeftTabParams>) {
    const { query, controlled } = useDataCatalogQuery(params)
    return (
      <DataExplorer
        adapter={options.adapter}
        facets={options.facets}
        groupBy={options.groupBy}
        onActivate={onSelect}
        getDragPayload={options.getDragPayload}
        emptyState={emptyState}
        searchPlaceholder={searchPlaceholder}
        query={controlled ? query : undefined}
        searchable={!controlled}
        pageSize={options.pageSize}
        debounceMs={options.debounceMs}
        className={className ?? "h-full"}
      />
    )
  }

  function DefaultVisualizationPanel({
    params,
    api,
    className,
  }: PaneProps<DataCatalogVisualizationParams>) {
    const { row, query, controlled, title } = useDataCatalogVisualizationState(
      params,
      visualizationTitle,
    )

    return (
      <PanelChrome
        title={title}
        icon={options.visualizationIcon ?? BarChart3}
        panelApi={api}
        className={className}
      >
        {row ? (
          <div className="border-b border-border/60 px-3 py-2">
            <div className="truncate text-sm font-medium text-foreground">{row.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.subtitle ?? row.id}
            </div>
          </div>
        ) : null}
        <DataExplorer
          adapter={options.adapter}
          facets={options.facets}
          groupBy={options.groupBy}
          onActivate={onSelect}
          getDragPayload={options.getDragPayload}
          emptyState={emptyState}
          searchPlaceholder={searchPlaceholder}
          query={controlled ? query : undefined}
          searchable={!controlled}
          pageSize={options.pageSize}
          debounceMs={options.debounceMs}
          className="h-full"
        />
      </PanelChrome>
    )
  }

  const outputs: PluginOutput[] = []

  if (includeLeftTab) {
    outputs.push({
      type: "left-tab",
      id: leftTabId,
      title: leftTabTitle,
      icon: options.leftTabIcon ?? Database,
      component: DataCatalogLeftTab,
      source,
      chromeless: true,
    })
  }

  if (includeVisualizationPanel) {
    const panel = definePanel<DataCatalogVisualizationParams>({
      id: visualizationPanelId,
      title: visualizationTitle,
      icon: options.visualizationIcon ?? BarChart3,
      component: options.visualizationComponent ?? DefaultVisualizationPanel,
      placement: "center",
      source,
    }) as PanelConfig

    outputs.push({
      type: "panel",
      panel,
    })
  }

  if (includeCatalog) {
    const catalog: CatalogConfig = {
      id: catalogId,
      label: catalogLabel,
      adapter: options.adapter,
      onSelect,
    }
    outputs.push({ type: "catalog", catalog })
  }

  if (includeSurfaceResolver) {
    outputs.push({
      type: "surface-resolver",
      resolver: createDataCatalogSurfaceResolver({
        id,
        catalogId,
        visualizationPanelId,
        visualizationTitle,
        panelIdPrefix: id,
        surfaceKind,
        surfaceResolverId: options.surfaceResolverId,
        source,
      }),
    })
  }

  return outputs
}

export function createDataCatalogPlugin(
  options: CreateDataCatalogPluginOptions,
): WorkspaceFrontPlugin {
  const pluginId = options.pluginId ?? options.id ?? DATA_CATALOG_PLUGIN_ID
  return defineFrontPlugin({
    id: pluginId,
    label: options.label ?? "Data Catalog",
    outputs: createDataCatalogOutputs(options),
  })
}

export function appendDataCatalogOutputs<T extends WorkspaceFrontPlugin>(
  plugin: T,
  options: CreateDataCatalogOutputsOptions,
): T {
  return defineFrontPlugin({
    ...plugin,
    outputs: [...(plugin.outputs ?? []), ...createDataCatalogOutputs(options)],
  }) as T
}

export function createDataCatalogCatalog(
  options: Pick<
    CreateDataCatalogOutputsOptions,
    "id" | "label" | "adapter" | "catalogId" | "catalogLabel" | "onSelect"
  >,
): CatalogConfig {
  return {
    id: options.catalogId ?? options.id ?? DATA_CATALOG_PLUGIN_ID,
    label: options.catalogLabel ?? options.label ?? "Data",
    adapter: options.adapter,
    onSelect: options.onSelect ?? (() => {}),
  }
}
