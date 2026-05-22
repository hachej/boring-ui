import type { ComponentType, ReactNode } from "react"
import type { DataExplorerProps } from "@hachej/boring-data-explorer/front"
import type {
  DragPayload,
  ExplorerDataSource,
  ExplorerItem,
  FacetConfig,
} from "@hachej/boring-data-explorer/shared"
import type { WorkspaceBridge } from "@hachej/boring-workspace"
import type { PaneProps, PanelConfig } from "@hachej/boring-workspace"
import type { LeftTabParams } from "@hachej/boring-workspace"

export interface DataCatalogVisualizationParams {
  row?: ExplorerItem
  query?: string
}

export interface OpenDataCatalogVisualizationOptions {
  catalogId: string
  surfaceKind?: string
  title?: string
  params?: Record<string, unknown>
}

export interface DataCatalogSelectContext {
  params?: LeftTabParams
  bridge?: WorkspaceBridge
}

export interface CreateDataCatalogContributionsOptions {
  /**
   * Base contribution id. Defaults catalog id to this value and left tab /
   * visualization panel ids to derived names.
   */
  id?: string
  label?: string
  adapter: ExplorerDataSource
  facets?: FacetConfig[]
  groupBy?: string
  getDragPayload?: (row: ExplorerItem) => DragPayload | null | undefined
  onSelect?: (row: ExplorerItem, context: DataCatalogSelectContext) => void
  emptyState?: ReactNode
  searchPlaceholder?: string
  pageSize?: number
  debounceMs?: number
  leftTabId?: string
  leftTabTitle?: string
  leftTabIcon?: PanelConfig["icon"]
  includeLeftTab?: boolean
  catalogId?: string
  catalogLabel?: string
  includeCatalog?: boolean
  visualizationPanelId?: string
  visualizationTitle?: string
  visualizationIcon?: PanelConfig["icon"]
  visualizationComponent?: ComponentType<PaneProps<DataCatalogVisualizationParams>>
  includeVisualizationPanel?: boolean
  surfaceKind?: string
  surfaceResolverId?: string
  includeSurfaceResolver?: boolean
  source?: PanelConfig["source"]
}

export interface CreateDataCatalogPluginOptions
  extends CreateDataCatalogContributionsOptions {
  pluginId?: string
}

export interface DataCatalogResolvedQuery {
  query?: string
  controlled: boolean
}

export interface DataCatalogVisualizationState extends DataCatalogResolvedQuery {
  row?: ExplorerItem
  title: string
}

export type { DataExplorerProps }
