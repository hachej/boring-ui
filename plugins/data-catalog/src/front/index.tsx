"use client"

import { BarChart3, Database } from "lucide-react"
import { PanelChrome } from "@hachej/boring-workspace"
import {
  definePlugin,
  type BoringFrontFactoryWithId,
  type BoringFrontSurfaceResolverRegistration,
} from "@hachej/boring-workspace/plugin"
import { DataExplorer } from "@hachej/boring-data-explorer/front"
import type { ExplorerItem } from "@hachej/boring-data-explorer/shared"
import type {
  CatalogConfig,
  LeftTabParams,
  WorkspaceBridge,
} from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace"
import {
  DATA_CATALOG_PLUGIN_ID,
  DATA_CATALOG_ROW_SURFACE_KIND,
} from "../shared/constants"
import { createDataCatalogOpenHandler } from "./openVisualization"
import { createDataCatalogSurfaceResolver } from "./surfaceResolver"
import {
  useDataCatalogQuery,
  useDataCatalogVisualizationState,
} from "./hooks"
import type {
  CreateDataCatalogPluginOptions,
  DataCatalogVisualizationParams,
} from "./types"

export {
  DATA_CATALOG_DEFAULT_TOOL_NAME,
  DATA_CATALOG_PLUGIN_ID,
  DATA_CATALOG_ROW_SURFACE_KIND,
} from "../shared/constants"
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
  CreateDataCatalogPluginOptions,
  DataCatalogResolvedQuery,
  DataCatalogSelectContext,
  DataExplorerProps,
  DataCatalogVisualizationParams,
  DataCatalogVisualizationState,
  OpenDataCatalogVisualizationOptions,
} from "./types"

/**
 * Builds a `BoringFrontFactoryWithId` for the data-catalog plugin.
 * The factory captures `options` in a closure and registers the
 * configured workspace page, visualization panel, catalog entry, and
 * surface resolver when the workspace calls it.
 *
 * Each contribution is opt-out via the `include*` flags so host apps
 * can compose a subset (e.g. catalog-only without a visualization
 * panel). The returned factory carries its `pluginId` + `pluginLabel`
 * so it can be passed directly to `WorkspaceProvider.plugins` (the
 * shell captures via the front factory API).
 */
export function createDataCatalogPlugin(
  options: CreateDataCatalogPluginOptions,
): BoringFrontFactoryWithId {
  const id = options.id ?? DATA_CATALOG_PLUGIN_ID
  const label = options.label ?? "Data"
  const catalogId = options.catalogId ?? id
  const catalogLabel = options.catalogLabel ?? label
  const workspacePageId = options.workspacePageId ?? options.leftTabId ?? `${id}-page`
  const workspacePageTitle = options.workspacePageTitle ?? options.leftTabTitle ?? label
  const workspacePageIcon = options.workspacePageIcon ?? options.leftTabIcon ?? Database
  const visualizationPanelId = options.visualizationPanelId ?? `${id}-visualization`
  const visualizationTitle = options.visualizationTitle ?? `${label} View`
  const surfaceKind = options.surfaceKind ?? DATA_CATALOG_ROW_SURFACE_KIND
  const source = options.source ?? "app"
  const includeVisualizationPanel = options.includeVisualizationPanel ?? true
  const includeWorkspacePage = options.includeWorkspacePage ?? options.includeLeftTab ?? true
  const includeCatalog = options.includeCatalog ?? true
  const includeSurfaceResolver =
    options.includeSurfaceResolver ?? (includeVisualizationPanel && !options.onSelect)
  const emptyState = options.emptyState ?? "No data found"
  const searchPlaceholder = options.searchPlaceholder ?? `Search ${label.toLowerCase()}...`
  const onSelect =
    options.onSelect ??
    (includeVisualizationPanel
      ? createDataCatalogOpenHandler({ catalogId, surfaceKind })
      : () => {})

  function DataCatalogWorkspacePage({ params, className }: PaneProps<LeftTabParams>) {
    const { query, controlled } = useDataCatalogQuery(params)
    const bridge = params?.bridge as WorkspaceBridge | undefined
    const handleSelect = (row: ExplorerItem) => onSelect(row, { params, bridge })
    const usesOuterChromeSearch = controlled && params?.chromeless === true
    return (
      <DataExplorer
        adapter={options.adapter}
        facets={options.facets}
        groupBy={options.groupBy}
        onActivate={handleSelect}
        getDragPayload={options.getDragPayload}
        emptyState={emptyState}
        searchPlaceholder={searchPlaceholder}
        toolbarTitle={usesOuterChromeSearch ? undefined : workspacePageTitle}
        toolbarIcon={usesOuterChromeSearch ? undefined : workspacePageIcon}
        query={usesOuterChromeSearch ? query : undefined}
        searchable={!usesOuterChromeSearch}
        toolbarPortalElement={usesOuterChromeSearch ? params?.chromeActionsElement : undefined}
        pageSize={options.pageSize}
        debounceMs={options.debounceMs}
        className={className ?? "h-full"}
      />
    )
  }

  function DefaultVisualizationPanel({
    params,
    api: panelApi,
    className,
  }: PaneProps<DataCatalogVisualizationParams>) {
    const { row, query, controlled, title } = useDataCatalogVisualizationState(
      params,
      visualizationTitle,
    )
    // Pass `params` so consumers can read panel state when handling a
    // row activation from inside the visualization panel itself (the
    // workspace-page path passes `{ params, bridge }`; this aligns
    // the two and unblocks bridge-aware callers from the panel route).
    const handleSelect = (nextRow: ExplorerItem) => onSelect(nextRow, { params })

    return (
      <PanelChrome
        title={title}
        icon={options.visualizationIcon ?? BarChart3}
        panelApi={panelApi}
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
          onActivate={handleSelect}
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

  const workspacePage = includeWorkspacePage
    ? {
        id: workspacePageId,
        label: workspacePageTitle,
        icon: workspacePageIcon,
        component: DataCatalogWorkspacePage,
        placement: "workspace-page" as const,
        source,
      }
    : undefined

  const visualizationPanel = includeVisualizationPanel
    ? {
        id: visualizationPanelId,
        label: visualizationTitle,
        icon: options.visualizationIcon ?? BarChart3,
        component: options.visualizationComponent ?? DefaultVisualizationPanel,
        placement: "center" as const,
        source,
      }
    : undefined

  const catalog: CatalogConfig | undefined = includeCatalog
    ? {
        id: catalogId,
        label: catalogLabel,
        adapter: options.adapter,
        onSelect: (row) => onSelect(row, {}),
      }
    : undefined

  const resolver: BoringFrontSurfaceResolverRegistration | undefined = includeSurfaceResolver
    ? createDataCatalogSurfaceResolver({
        id,
        catalogId,
        visualizationPanelId,
        visualizationTitle,
        panelIdPrefix: id,
        surfaceKind,
        surfaceResolverId: options.surfaceResolverId,
        source,
      })
    : undefined

  return definePlugin({
    id,
    label,
    panels: [workspacePage, visualizationPanel].filter((panel): panel is NonNullable<typeof workspacePage> | NonNullable<typeof visualizationPanel> => Boolean(panel)),
    catalogs: catalog ? [catalog] : [],
    surfaceResolvers: resolver ? [resolver] : [],
  })
}
